import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireSession } from "@/lib/properties/access";
import { canTransition, statusSideEffects } from "@/lib/properties/status";
import { toSafeProperty, toStatusCounts } from "@/lib/properties/serialize";
import { propertyCreateSchema, propertyListQuerySchema } from "@/lib/validation/property";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { jsonError, jsonOk, jsonServerError, zodFieldErrors } from "@/lib/utils/api-response";

/**
 * `/api/properties` — the owner's collection.
 *
 * Both handlers are scoped to `ownerId: user.id`, taken from the
 * server-verified session. There is no query parameter that widens the scope:
 * "list properties for owner X" is not an operation this endpoint offers, so
 * there is nothing to authorize beyond "are you logged in".
 */

/** One owner creating listings faster than this is spamming, not selling. */
const CREATE_LIMIT = 15;
const CREATE_WINDOW_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const query = propertyListQuerySchema.parse({
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      perPage: request.nextUrl.searchParams.get("perPage") ?? undefined,
    });

    const where = {
      ownerId: session.user.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total, statusGroups] = await Promise.all([
      prisma.property.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      prisma.property.count({ where }),
      // Counts are always across *all* of the owner's listings, not the current
      // filter — they populate the filter tabs themselves, which have to show
      // "Published 3" while the Draft tab is the one being viewed.
      prisma.property.groupBy({
        by: ["status"],
        where: { ownerId: session.user.id },
        _count: { _all: true },
      }),
    ]);

    return jsonOk({
      properties: rows.map(toSafeProperty),
      total,
      page: query.page,
      perPage: query.perPage,
      counts: toStatusCounts(statusGroups),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Invalid query parameters.", 400, zodFieldErrors(error));
    }
    console.error("[properties] list failed:", error);
    return jsonServerError();
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const limit = await checkRateLimit(
    "property-create",
    session.user.id,
    CREATE_LIMIT,
    CREATE_WINDOW_MS
  );
  if (!limit.allowed) {
    return jsonError(
      `You've added a lot of listings in a short time. Try again in ${Math.ceil(
        limit.retryAfterMs / 60000
      )} minute(s).`,
      429
    );
  }

  try {
    const body = await request.json();
    const { publish, ...data } = propertyCreateSchema.parse(body);

    // "Save & publish" is still a real DRAFT -> PUBLISHED transition, checked
    // against the same table the status endpoint uses rather than by writing
    // PUBLISHED directly. If the table ever stops allowing it, this stops too.
    const publishing = publish && canTransition("DRAFT", "PUBLISHED", session.user.role);
    const now = new Date();

    const created = await prisma.property.create({
      data: {
        ...data,
        // The authorization anchor, and the only place it is ever written.
        ownerId: session.user.id,
        status: publishing ? "PUBLISHED" : "DRAFT",
        ...(publishing
          ? statusSideEffects("PUBLISHED", { publishedAt: null }, session.user.id, now)
          : {}),
      },
    });

    return jsonOk({ property: toSafeProperty(created) }, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError("Please fix the highlighted fields.", 400, zodFieldErrors(error));
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid request body.", 400);
    }
    console.error("[properties] create failed:", error);
    return jsonServerError();
  }
}

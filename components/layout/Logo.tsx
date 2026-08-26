import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("group flex items-center gap-2.5 shrink-0", className)}
      aria-label="PROPERTYNEX home"
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-b shadow-glow transition-transform duration-300 group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" aria-hidden="true">
          <path
            d="M12 3.5L20.5 9.5V20.5H3.5V9.5L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="14" r="1.8" fill="currentColor" />
        </svg>
      </span>
      <span className="text-lg font-extrabold tracking-tight text-white">
        PROPERTY<span className="text-cyan">NEX</span>
      </span>
    </Link>
  );
}

export function BackgroundOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-royal/25 blur-[110px] animate-orb-float" />
      <div
        className="absolute top-1/3 -right-24 h-[28rem] w-[28rem] rounded-full bg-cyan/20 blur-[120px] animate-orb-float"
        style={{ animationDelay: "-4s" }}
      />
      <div
        className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-violet/20 blur-[110px] animate-orb-float"
        style={{ animationDelay: "-8s" }}
      />
    </div>
  );
}

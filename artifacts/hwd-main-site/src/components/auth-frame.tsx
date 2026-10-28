import type { ReactNode } from "react";

export function AuthFrame({ children }: { children: ReactNode }) {
  const img = `${import.meta.env.BASE_URL}images/hwd-farm-illustration.jpg`;
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden lg:block overflow-hidden border-r">
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(150_25%_12%/0.55)] to-transparent" />
        <p className="absolute bottom-8 left-8 font-display text-[hsl(44_40%_97%)] text-3xl">HWD Farm<span className="block text-base opacity-80 mt-1">Lee, Massachusetts</span></p>
      </div>
      <div className="flex flex-col">
        <img src={img} alt="" className="lg:hidden h-44 w-full object-cover border-b" />
        <div className="flex-1 grid place-items-center px-6 py-10">
          <div className="w-full max-w-sm rise">
            <p className="font-display text-xl text-primary mb-8 lg:mb-12">HWD Farm</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

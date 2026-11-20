"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navItems } from "./sidebar";

export function BottomNav() {
  const pathname = usePathname();
  
  // Filter the shared array down to the exact 4 mobile tabs based on our config flag
  const mobileItems = navItems.filter((item) => item.showOnMobile);

  return (
    <nav 
      className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-cb-border bg-cb-sidebar px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile Navigation"
    >
      {mobileItems.map((item) => {
        const isActive = pathname === item.href;
        
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={(e) => !["/", "/repositories", "/chat", "/search", "/conversations", "/settings"].includes(item.href) && e.preventDefault()} // Placeholder for unbuilt pages
            className={cn(
              "flex h-16 w-16 flex-col items-center justify-center gap-1 transition-colors",
              isActive 
                ? "text-cb-primary" 
                : "text-cb-text-secondary hover:text-cb-text-primary"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span className="text-[10px] font-medium tracking-wide">
              {item.mobileName}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
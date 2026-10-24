"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({
  text,
  children,
  position = "top",
  color,
  disabled = false,
  className = "inline-flex",
}) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords(rect);
  }, []);

  const handleMouseEnter = () => {
    if (disabled || !text) return;
    updateCoords();
    setVisible(true);
  };

  const handleMouseLeave = () => {
    setVisible(false);
  };

  const handleClick = () => {
    setVisible(false);
  };

  // Close when window scrolls or resizes
  useEffect(() => {
    if (!visible) return;
    const handleScrollOrResize = () => {
      setVisible(false);
    };
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [visible]);

  useEffect(() => {
    if (disabled) setVisible(false);
  }, [disabled]);

  if (disabled || !text) {
    return <>{children}</>;
  }

  let style = {};
  if (coords) {
    const gap = 8;
    if (position === "right") {
      style = {
        top: `${coords.top + coords.height / 2}px`,
        left: `${coords.right + gap}px`,
        transform: "translateY(-50%)",
      };
    } else if (position === "bottom") {
      style = {
        top: `${coords.bottom + gap}px`,
        left: `${coords.left + coords.width / 2}px`,
        transform: "translateX(-50%)",
      };
    } else if (position === "left") {
      style = {
        top: `${coords.top + coords.height / 2}px`,
        left: `${coords.left - gap}px`,
        transform: "translate(-100%, -50%)",
      };
    } else {
      // top
      style = {
        top: `${coords.top - gap}px`,
        left: `${coords.left + coords.width / 2}px`,
        transform: "translate(-50%, -100%)",
      };
    }
  }

  const bgStyle = color ? { backgroundColor: color } : {};
  const bgClass = color
    ? ""
    : "bg-gray-900/95 dark:bg-gray-800/95 border border-white/10";

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={className}
    >
      {children}
      {mounted &&
        visible &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`fixed pointer-events-none z-[9999] w-max max-w-64 rounded-md px-2.5 py-1 text-[11px] font-medium leading-snug ${bgClass} text-white shadow-xl whitespace-normal pointer-events-none animate-in fade-in zoom-in-95 duration-100`}
            style={{ ...style, ...bgStyle }}
          >
            {text}
          </div>,
          document.body
        )}
    </div>
  );
}

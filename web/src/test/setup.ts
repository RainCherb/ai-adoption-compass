import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom не реализует прокрутку; страницы вызывают её при переходах.
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.body.style.overflow = "";
});

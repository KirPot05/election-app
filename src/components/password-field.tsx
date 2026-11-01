"use client";

import { useState, type ComponentProps } from "react";
import { Field } from "./ui";

/** Password input with a show/hide toggle (helps on small phone keyboards). */
export function PasswordField(props: ComponentProps<typeof Field>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Field
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
        aria-pressed={visible}
        className="absolute right-1 top-[1.85rem] flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold text-indigo-700"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

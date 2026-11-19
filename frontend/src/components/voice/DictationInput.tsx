import * as React from "react"
import { VoiceMic } from "./VoiceMic"

/**
 * A drop-in replacement for a one-line <input> with a microphone at the right end. Same props and the same onChange
 * (dictated text arrives through a real input event); the field stays fully editable. For clinical one-liners: diagnosis,
 * allergies, chief complaint, medicine instructions.
 */
const DictationInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function DictationInput(props, ref) {
  const inner = React.useRef<HTMLInputElement | null>(null)
  const [interim, setInterim] = React.useState("")
  const [error, setError] = React.useState("")

  const setRefs = (el: HTMLInputElement | null) => {
    inner.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el
  }

  const insert = (text: string) => {
    const el = inner.current
    if (!el) return
    const cur = el.value
    // a one-liner has no line breaks: a spoken "new line" becomes a space
    const add = text.replace(/\s*\n+\s*/g, " ").trim()
    const next = !cur.trim() ? add : cur.replace(/\s+$/, "") + " " + add
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(el, next)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const { disabled, readOnly, type } = props
  const textual = !type || type === "text" || type === "search"
  if (!textual) return <input {...props} ref={setRefs} />
  return (
    <span className="relative block w-full">
      <input {...props} ref={setRefs} style={{ paddingRight: "2.4rem", ...props.style }} />
      {!disabled && !readOnly && (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 z-10">
          <VoiceMic compact onText={insert} onInterim={setInterim} onError={setError} />
        </span>
      )}
      {(interim || error) && <span className={`block text-[11.5px] mt-0.5 ${error ? "text-red-700" : "text-slate-500 italic"}`}>{error || `Hearing: ${interim}`}</span>}
    </span>
  )
})

export default DictationInput

import * as React from "react"
import { VoiceMic } from "./VoiceMic"

/**
 * A drop-in replacement for <textarea> that adds a microphone in the corner. Everything else is the plain textarea:
 * the same props, the same onChange (dictated text arrives through a real input event, so controlled and
 * uncontrolled boxes, and every existing handler, work unchanged) and the box stays fully editable.
 */
const DictationTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function DictationTextarea(props, ref) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null)
  const [interim, setInterim] = React.useState("")
  const [error, setError] = React.useState("")

  const setRefs = (el: HTMLTextAreaElement | null) => {
    inner.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
  }

  const insert = (text: string) => {
    const el = inner.current
    if (!el) return
    const cur = el.value
    const next = !cur.trim() ? text : cur.endsWith("\n") ? cur + text : cur.replace(/\s+$/, "") + " " + text
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(el, next)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const { disabled, readOnly } = props
  return (
    <div className="relative w-full">
      <textarea {...props} ref={setRefs} style={{ paddingRight: "2.4rem", ...props.style }} />
      {!disabled && !readOnly && (
        <div className="absolute right-1.5 bottom-1.5 z-10">
          <VoiceMic compact onText={insert} onInterim={setInterim} onError={setError} />
        </div>
      )}
      {(interim || error) && (
        <div className={`text-[11.5px] mt-0.5 ${error ? "text-red-700" : "text-slate-500 italic"}`}>{error || `Hearing: ${interim}`}</div>
      )}
    </div>
  )
})

export default DictationTextarea

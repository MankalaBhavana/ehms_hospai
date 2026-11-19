import * as React from "react"
import { cn } from "../../lib/cn"
import DictationTextarea from "../voice/DictationTextarea"

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Adds a microphone (voice typing) to the box: for clinical free text. */
  dictate?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, Props>(({ className, dictate, ...props }, ref) => {
  const Tag = dictate ? DictationTextarea : "textarea"
  return <Tag ref={ref} className={cn("ui-textarea", className)} {...props} />
})

Textarea.displayName = "Textarea"

export default Textarea

import type { ComprehensiveClaimRecord } from "../../types/insurance"
import type { DeskStepId } from "./deskGuide"

/**
 * The insurance procedure, written out as small steps. Each step knows how to look at a real
 * case and say whether it is done, still to do, or does not apply -- so the plan is a live
 * checklist for the case in front of you, not a static document.
 */
export type ItemState = "done" | "todo" | "na"

export interface PlanItem {
  id: string
  title: string
  /** One plain sentence: what this step is. */
  what: string
  /** Why it matters / what goes wrong without it. */
  why: string
  /** Click-by-click instructions. */
  how: string[]
  who: string
  where: string
  /** Menu key to open for this step. */
  go?: { module: string; label: string }
  check: (c: ComprehensiveClaimRecord) => ItemState
  /** Shown next to a todo step when the case data tells us something specific. */
  live?: (c: ComprehensiveClaimRecord) => string | undefined
}

export interface PlanStage {
  id: DeskStepId
  title: string
  goal: string
  /** What must be true to leave this stage. */
  exit: string
  items: PlanItem[]
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN")
const docDone = (c: ComprehensiveClaimRecord, re: RegExp, verified = false) =>
  c.documents.some((d) => re.test(d.documentType) && d.isUploaded && (!verified || d.status === "Verified"))
const mandatoryIn = (c: ComprehensiveClaimRecord, cats: string[]) => c.documents.filter((d) => d.isMandatory && cats.includes(d.category))
const verifiedCount = (c: ComprehensiveClaimRecord, cats: string[]) => {
  const m = mandatoryIn(c, cats)
  return { total: m.length, ok: m.filter((d) => d.isUploaded && d.status === "Verified").length }
}
/** Nothing required by the hospital's document rules counts as satisfied. */
const allVerified = (c: ComprehensiveClaimRecord, cats: string[]) => {
  const v = verifiedCount(c, cats)
  return v.ok === v.total
}
const reimb = (c: ComprehensiveClaimRecord) => c.claimType === "Reimbursement"
const noPreAuth = (c: ComprehensiveClaimRecord) => reimb(c) || (!!c.eligibility && c.policy.preAuthRequired === false)
const after = (c: ComprehensiveClaimRecord, list: string[]) => list.includes(c.status)
const pastTreatment = (c: ComprehensiveClaimRecord) => ["DISCHARGE_INITIATED", "FINAL_BILL_READY", ...CLAIM_ON].includes(c.status)
const CLAIM_ON = ["CLAIM_SUBMITTED", "CLAIM_QUERY_RAISED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "SETTLEMENT_PENDING", "PAYMENT_RECEIVED", "RECONCILED", "CLOSED"]
const DECIDED = ["APPROVED", "PARTIALLY_APPROVED", "SETTLEMENT_PENDING", "PAYMENT_RECEIVED", "RECONCILED", "CLOSED"]

export const PLAN: PlanStage[] = [
  {
    id: "admission",
    title: "1. Patient admission & policy details",
    goal: "Open the insurance case and record exactly what is on the patient's insurance card.",
    exit: "Insurer, policy number and the two identity documents are on the case.",
    items: [
      {
        id: "policy",
        title: "Enter the insurer and policy details",
        what: "Record the insurance company, the TPA (if any), the policy number and the member ID.",
        why: "Every email, form and claim uses these. A wrong policy number is the commonest reason for a rejected claim.",
        how: [
          "Open Insurance → Intake & Eligibility, or press New case in Claims.",
          "Choose Cashless (insurer pays the hospital) or Reimbursement (patient pays first).",
          "Pick the admitted patient from the bed board, or type the UHID and name.",
          "Copy the insurer, TPA, policy number and member ID from the card exactly as printed.",
          "Press Open insurance case. The case starts at Eligibility.",
        ],
        who: "Insurance executive (or admission desk)",
        where: "Insurance → Intake & Eligibility",
        go: { module: "insurance_eligibility", label: "Open Intake" },
        check: (c) => (c.policy.insurerName && c.policy.policyNumber ? "done" : "todo"),
        live: (c) => (!c.policy.policyNumber ? "Policy number is still missing (quick capture). Add it before sending anything to the insurer." : undefined),
      },
      {
        id: "card",
        title: "Upload the insurance / TPA card",
        what: "Add a clear photo or scan of the front and back of the card.",
        why: "The insurer asks for it with the pre-authorisation. Without it the request is returned.",
        how: ["Open the case → Documents tab.", "Find “Insurance / TPA Card” and press Upload.", "After uploading, press Verify once you have checked the card is readable."],
        who: "Insurance executive",
        where: "Case → Documents",
        check: (c) => (docDone(c, /card/i) ? "done" : "todo"),
      },
      {
        id: "idproof",
        title: "Upload the patient's photo ID",
        what: "Aadhaar or PAN of the patient.",
        why: "Insurers match the ID to the policy holder. Missing ID causes a query.",
        how: ["Case → Documents → “Patient ID Proof”.", "Upload, check the name matches the policy, then Verify."],
        who: "Insurance executive",
        where: "Case → Documents",
        check: (c) => (docDone(c, /id proof|aadhaar|pan/i) ? "done" : "todo"),
      },
      {
        id: "link",
        title: "Make sure the case is linked to the admission",
        what: "The case should be tied to the patient's admission and hospital bill so charges flow in by themselves.",
        why: "Linked cases show the live bill. You never retype charges.",
        how: ["Open the case: the Hospital bill figure should appear once billing has a bill for the stay.", "If it stays empty after admission, ask billing to confirm the admission bill exists."],
        who: "Insurance executive with billing",
        where: "Case header",
        check: (c) => (c.billingClaimId || c.invoiceNo || after(c, CLAIM_ON) || after(c, ["FINAL_BILL_READY"]) ? "done" : "todo"),
      },
    ],
  },
  {
    id: "eligibility",
    title: "2. Eligibility verification",
    goal: "Find out from the insurer whether the policy is valid and what it covers before treatment goes far.",
    exit: "The insurer's answer is recorded: eligible, with limits; or not eligible.",
    items: [
      {
        id: "ask",
        title: "Ask the insurer / TPA to confirm the policy",
        what: "Check the policy by portal, phone or email.",
        why: "A policy can be lapsed, exhausted or in a waiting period even if the patient has the card.",
        how: [
          "Open the case → Current step.",
          "Fastest: use the insurer's portal or phone line and note the reference number they give you.",
          "By email: press Send email → Eligibility. The address is filled from the insurer master; check it, then send.",
        ],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (c.eligibility || (c.mails ?? []).some((m) => m.purpose === "Eligibility") ? "done" : "todo"),
      },
      {
        id: "record",
        title: "Record what the insurer confirmed",
        what: "Enter the result: eligible or not, sum insured, balance, room eligibility, co-pay, and whether pre-authorisation is needed.",
        why: "These numbers decide the pre-auth amount and what the patient will have to pay.",
        how: [
          "Case → Current step → Record eligibility.",
          "Choose the method you used and the insurer's reference.",
          "Fill sum insured, available balance, room category and co-pay %.",
          "Tick whether pre-authorisation is required. If the insurer says it is not, the case can go straight to treatment.",
          "Save. The case moves to Eligible, or to Not eligible.",
        ],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (c.eligibility ? "done" : "todo"),
      },
      {
        id: "decide",
        title: "If not eligible: decide what happens",
        what: "Re-check with the insurer, or move the patient to self-pay.",
        why: "Treatment should not continue on the assumption of cover that does not exist.",
        how: ["Ask the insurer why (lapsed, waiting period, exclusion).", "If it was a wrong number, correct the policy and record eligibility again.", "If cover is truly absent, tell the family and billing; the bill becomes self-pay."],
        who: "Insurance manager",
        where: "Case → Current step",
        check: (c) => (c.status === "NOT_ELIGIBLE" ? "todo" : c.eligibility ? "done" : "na"),
        live: (c) => (c.status === "NOT_ELIGIBLE" ? "The insurer declined cover. This case is stopped until you resolve it." : undefined),
      },
    ],
  },
  {
    id: "preauth",
    title: "3. Pre-authorisation",
    goal: "Get the insurer's written approval and an approval code before the expensive treatment.",
    exit: "The insurer approved an amount and gave an approval code.",
    items: [
      {
        id: "request",
        title: "Prepare the pre-auth request",
        what: "Write the diagnosis, the planned procedures and the treating doctor.",
        why: "This is what the insurer's doctor reads to decide.",
        how: [
          "Open Insurance → Pre-Authorization and pick the case.",
          "Enter the diagnosis (and ICD code if you have it) and a short clinical summary.",
          "Add the planned procedure packages; their rates fill in by themselves.",
          "Enter expected stay days and any other charges. The estimated total is calculated for you.",
          "Save the draft.",
        ],
        who: "Insurance executive with the treating doctor",
        where: "Insurance → Pre-Authorization",
        go: { module: "insurance_preauth", label: "Open Pre-Authorization" },
        check: (c) => (noPreAuth(c) ? "na" : c.preAuth?.diagnosis ? "done" : "todo"),
      },
      {
        id: "docs",
        title: "Upload and verify the required documents",
        what: "Everything the insurer needs with the request (ID, card, doctor's notes, investigation reports).",
        why: "The application will not send a pre-auth until the required documents are verified.",
        how: ["Case → Documents.", "Upload each required document (marked *).", "Open it, check it is the right patient and readable, then press Verify."],
        who: "Insurance executive",
        where: "Case → Documents",
        check: (c) => {
          if (noPreAuth(c)) return "na"
          return allVerified(c, ["Patient", "Insurance", "Pre-Auth", "Clinical"]) ? "done" : "todo"
        },
        live: (c) => {
          const v = verifiedCount(c, ["Patient", "Insurance", "Pre-Auth", "Clinical"])
          return v.total && v.ok < v.total ? `${v.ok} of ${v.total} required documents are verified.` : undefined
        },
      },
      {
        id: "send",
        title: "Send the request to the insurer",
        what: "Email it (from the linked mailbox) or record that you submitted it on the insurer's portal.",
        why: "The clock on the insurer's side starts only when it is sent.",
        how: [
          "Case → Current step → Send email → Pre-Auth.",
          "Check the To address, tick the documents and add the actual files with Add files.",
          "Press Send. Using the insurer's portal instead? Choose “Submitted through the insurer's portal” and enter the reference.",
          "The case becomes Pre-auth submitted.",
        ],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (noPreAuth(c) ? "na" : c.preAuth?.submittedAt ? "done" : "todo"),
      },
      {
        id: "answer",
        title: "Answer insurer questions",
        what: "If the insurer raises a query, reply with the missing information.",
        why: "The approval is on hold until you answer.",
        how: ["Open the Email Hub and press Check mailbox for replies.", "Open the case: the query appears with a due date.", "Press Answer, attach what they asked for, verify it, and send the reply."],
        who: "Insurance executive",
        where: "Email Hub → case",
        go: { module: "insurance_emails", label: "Open Email Hub" },
        check: (c) => (noPreAuth(c) ? "na" : (c.queries ?? []).some((q) => q.stage === "Pre-Auth" && q.status !== "Closed" && q.status !== "Response Submitted") ? "todo" : "done"),
      },
      {
        id: "decision",
        title: "Record the insurer's decision",
        what: "Enter Approved (amount and approval code), Query, or Rejected.",
        why: "Treatment is covered only up to the approved amount, and the approval code is needed later for the claim.",
        how: [
          "Press Check mailbox for replies in the Email Hub, or paste the reply into the case.",
          "Open the case → Record decision.",
          "Approved: enter the approved amount and the insurer's approval code exactly as written.",
          "Rejected: write the reason, fix the request and send it again as a new draft.",
        ],
        who: "Insurance executive",
        where: "Email Hub / Case → Current step",
        check: (c) => (noPreAuth(c) ? "na" : c.preAuth?.approvalCode || (c.approvedPreAuthAmount ?? 0) > 0 ? "done" : "todo"),
        live: (c) => (c.status === "PREAUTH_REJECTED" ? "The pre-auth was rejected. Revise the request and send it again." : undefined),
      },
    ],
  },
  {
    id: "treatment",
    title: "4. Treatment / surgery",
    goal: "Keep the running bill inside the approved amount while the patient is treated.",
    exit: "The patient is ready for discharge.",
    items: [
      {
        id: "started",
        title: "Confirm treatment is under approval",
        what: "Once approved, the case moves to Treatment in progress by itself.",
        why: "This is the green light for the ward and OT.",
        how: ["Check the case status reads Treatment in progress.", "For policies that need no pre-auth: press Start treatment without pre-auth."],
        who: "Insurance executive",
        where: "Case header",
        check: (c) => (after(c, ["TREATMENT_IN_PROGRESS", "DISCHARGE_INITIATED", "FINAL_BILL_READY"]) || after(c, CLAIM_ON) ? "done" : "todo"),
      },
      {
        id: "within",
        title: "Watch the bill against the approved amount",
        what: "Compare the hospital bill with the authorised amount every day.",
        why: "Amounts above the approval are usually refused unless an enhancement was approved.",
        how: ["Look at “Amounts at a glance”: Hospital bill vs Authorised.", "If the bill will pass the authorised amount, request an enhancement before it does."],
        who: "Insurance executive",
        where: "Case → Amounts at a glance",
        check: (c) => (!pastTreatment(c) && c.approvedPreAuthAmount && c.totalHospitalBill > c.approvedPreAuthAmount && !(c.preAuth?.enhancements ?? []).some((e) => e.status === "Approved") ? "todo" : "done"),
        live: (c) =>
          c.approvedPreAuthAmount && c.totalHospitalBill > c.approvedPreAuthAmount
            ? `Bill ${inr(c.totalHospitalBill)} is above the authorised ${inr(c.approvedPreAuthAmount)}. Request an enhancement.`
            : undefined,
      },
      {
        id: "enh",
        title: "Request an enhancement if needed",
        what: "Ask the insurer to raise the approved amount, with the reason and the new total.",
        why: "It keeps the extra cost covered.",
        how: ["Case → Current step → Request enhancement.", "Enter the new total amount (it must be higher than the current approval) and the clinical reason.", "Send it by email, then record the insurer's answer."],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => ((c.preAuth?.enhancements ?? []).length ? (!pastTreatment(c) && (c.preAuth?.enhancements ?? []).some((e) => e.status === "Requested") ? "todo" : "done") : "na"),
      },
    ],
  },
  {
    id: "discharge",
    title: "5. Discharge & final bill",
    goal: "Close the clinical part and get one final, itemised bill from billing.",
    exit: "Billing has handed the final bill to insurance and the discharge documents are verified.",
    items: [
      {
        id: "initiate",
        title: "Initiate discharge",
        what: "Tell the system the patient is being discharged.",
        why: "Billing can hand over the final bill only after this. It also adds the discharge documents to the checklist.",
        how: ["Open the case → Current step.", "Press Initiate discharge.", "The case becomes Discharge initiated."],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (c.dischargeDate || after(c, ["DISCHARGE_INITIATED", "FINAL_BILL_READY"]) || after(c, CLAIM_ON) ? "done" : "todo"),
      },
      {
        id: "dischargedocs",
        title: "Collect and verify the discharge documents",
        what: "Discharge summary, final itemised bill, investigation reports.",
        why: "The claim cannot be sent without them.",
        how: ["Ask the ward / doctor for the signed discharge summary.", "Upload each document under Documents, then Verify."],
        who: "Insurance executive with nursing",
        where: "Case → Documents",
        check: (c) => (allVerified(c, ["Discharge", "Billing", "Clinical"]) ? "done" : "todo"),
        live: (c) => {
          const v = verifiedCount(c, ["Discharge", "Billing", "Clinical"])
          return v.total && v.ok < v.total ? `${v.ok} of ${v.total} required documents are verified.` : undefined
        },
      },
      {
        id: "finalbill",
        title: "Billing hands over the final bill",
        what: "At the IP billing counter, the final bill is sent to insurance (“Bill to insurance”).",
        why: "The claim amount comes from this bill: the insurer's part and the patient's part are split on it.",
        how: ["Ask billing to open the patient's bill and press Bill to insurance.", "The case becomes Final bill ready on its own.", "If billing is told the case is not ready, finish the earlier stages first; the message says which."],
        who: "Billing executive",
        where: "Billing → IP counter",
        go: { module: "billing_ip", label: "Open IP billing" },
        check: (c) => (after(c, ["FINAL_BILL_READY"]) || after(c, CLAIM_ON) ? "done" : "todo"),
      },
    ],
  },
  {
    id: "submission",
    title: "6. Claim submission",
    goal: "Send the complete claim to the insurer.",
    exit: "The claim is sent and its reference is recorded.",
    items: [
      {
        id: "allverified",
        title: "Check every claim document is verified",
        what: "All required documents for the claim, ticked and verified.",
        why: "The application blocks submission if any is missing, so check first.",
        how: ["Case → Documents → see how many required documents are verified.", "Fix any marked Missing or Rejected."],
        who: "Insurance executive",
        where: "Case → Documents",
        check: (c) => (allVerified(c, ["Patient", "Insurance", "Pre-Auth", "Clinical", "Billing", "Discharge"]) ? "done" : "todo"),
      },
      {
        id: "amount",
        title: "Confirm the claim amount",
        what: "The amount asked from the insurer: the bill minus what the patient pays.",
        why: "A zero or wrong amount is the second commonest cause of rejection.",
        how: ["Look at Claimed from insurer in Amounts at a glance.", "If it is zero, billing has not split the bill: ask them to check the insurance split."],
        who: "Insurance executive with billing",
        where: "Case → Amounts at a glance",
        check: (c) => (c.finalClaimAmount > 0 ? "done" : "todo"),
      },
      {
        id: "sendclaim",
        title: "Send the claim",
        what: "Email the claim with the documents, or record the portal submission.",
        why: "This starts the insurer's review.",
        how: ["Case → Current step → Send email → Claim.", "Check the address, tick documents and add the files, then Send.", "Reimbursement: give the claim pack to the patient and press “Patient has submitted to insurer”."],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (after(c, CLAIM_ON) ? "done" : "todo"),
      },
    ],
  },
  {
    id: "adjudication",
    title: "7. Insurer review & decision",
    goal: "Answer questions and record the insurer's decision on the claim.",
    exit: "The decision (approved, partly approved or rejected) is recorded with its reasons.",
    items: [
      {
        id: "claimqueries",
        title: "Answer claim queries",
        what: "Reply to anything the insurer asks about the claim.",
        why: "A claim with an open query is not paid.",
        how: ["Press Check mailbox for replies each morning.", "Open the case, press Answer on the query, attach the documents and send."],
        who: "Insurance executive",
        where: "Email Hub / Case",
        check: (c) => (!after(c, CLAIM_ON) ? "na" : (c.queries ?? []).some((q) => q.stage === "Claim" && q.status !== "Closed" && q.status !== "Response Submitted") ? "todo" : "done"),
      },
      {
        id: "claimdecision",
        title: "Record the decision",
        what: "Approved, partly approved with deductions, or rejected.",
        why: "It creates the settlement record that payment and reconciliation depend on.",
        how: [
          "Open the case → Record decision.",
          "Approved: enter the sanctioned amount.",
          "Partly approved: enter the sanctioned amount and list every deduction with its reason; the deductions must add up to the shortfall.",
          "Rejected: write the reason. You can then file an appeal with your grounds.",
        ],
        who: "Insurance executive",
        where: "Case → Current step",
        check: (c) => (after(c, DECIDED) ? "done" : c.status === "REJECTED" ? "todo" : after(c, CLAIM_ON) ? "todo" : "na"),
        live: (c) => (c.status === "REJECTED" ? "The claim was rejected. File an appeal or close it." : undefined),
      },
    ],
  },
  {
    id: "settlement",
    title: "8. Settlement & reconciliation",
    goal: "Receive the money, match it to the claim and close.",
    exit: "The payment is reconciled and the claim is closed.",
    items: [
      {
        id: "advice",
        title: "Record the settlement advice",
        what: "Enter the advice number the insurer sends before paying.",
        why: "It tells accounts what to expect and when.",
        how: ["Open Insurance → Settlement & Reconciliation.", "Pick the case, press Record advice, and enter the advice number and the expected date."],
        who: "Accounts executive",
        where: "Insurance → Settlement & Reconciliation",
        go: { module: "insurance_settlement", label: "Open Settlement" },
        check: (c) => (c.settlement?.settlementAdviceNo || after(c, ["PAYMENT_RECEIVED", "RECONCILED", "CLOSED"]) ? "done" : after(c, DECIDED) ? "todo" : "na"),
      },
      {
        id: "payment",
        title: "Record the payment received",
        what: "Enter the amount, the UTR and the bank account it came into.",
        why: "Never mark a claim as paid because it was approved. Only money in the bank counts.",
        how: ["Match the credit on the bank statement.", "Press Record payment: amount, UTR / reference, date and account.", "If the amount is less than sanctioned, it is flagged as a short payment."],
        who: "Accounts executive",
        where: "Insurance → Settlement & Reconciliation",
        check: (c) => ((c.settlement?.receivedAmount ?? 0) > 0 ? "done" : after(c, DECIDED) ? "todo" : "na"),
      },
      {
        id: "reconcile",
        title: "Reconcile and close",
        what: "Confirm the received amount against the sanctioned amount, explain any difference, then close.",
        why: "It is the control that proves every insurer payment was matched to a claim.",
        how: ["Press Reconcile. A short payment needs a written explanation (for example TDS or a deduction).", "Press Close claim. Closed claims cannot be changed."],
        who: "Accounts executive / Insurance manager",
        where: "Insurance → Settlement & Reconciliation",
        check: (c) => (after(c, ["RECONCILED", "CLOSED"]) ? "done" : after(c, ["PAYMENT_RECEIVED"]) ? "todo" : "na"),
      },
    ],
  },
]

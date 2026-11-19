import "./shim"
import { canOpenScreen, grantedScreens } from "../src/utils/accessControl"
const perms = ["dashboard", "patients.documents", "symptom_ai.documents"]
console.log("laboratory:", canOpenScreen("laboratory", "ROLE_LAB_TECHNICIAN", perms), "register:", canOpenScreen("register", "ROLE_LAB_TECHNICIAN", perms))
console.log([...grantedScreens("ROLE_LAB_TECHNICIAN", perms)].slice(0, 12).join(","))

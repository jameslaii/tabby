import { Onboarding } from "../../components/Onboarding";
import { listGroups } from "../../lib/store";

export default function WelcomePage() {
  return <Onboarding hasGroups={listGroups().length > 0} />;
}

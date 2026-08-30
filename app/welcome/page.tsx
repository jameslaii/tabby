"use client";

import { Onboarding } from "../../components/Onboarding";
import { useStore } from "../../components/StoreProvider";

export default function WelcomePage() {
  const { db, ready } = useStore();
  // Until stored data is read, assume no groups — that's the first-run case,
  // and it only changes the wording of the final button.
  return <Onboarding hasGroups={ready && db.groups.length > 0} />;
}

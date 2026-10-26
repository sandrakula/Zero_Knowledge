import { redirect } from 'next/navigation'

/**
 * The setup checklist was removed from the product. Keep the old URL working
 * by sending anyone who has it bookmarked straight to the dashboard.
 */
export default function OnboardingPage() {
  redirect('/dash')
}

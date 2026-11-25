import TaskBankClient from './client'

export const metadata = {
  title: 'Банк задач',
  robots: { index: false, follow: false },
}

export default function TaskBankPage() {
  return <TaskBankClient />
}

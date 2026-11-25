import { redirect } from 'next/navigation'

async function BoardSettingsRedirectPage(props: any) {
  const params = await props.params
  redirect(`/cabinet/boards/${params.boarduuid}/general`)
}

export default BoardSettingsRedirectPage

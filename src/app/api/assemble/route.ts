import { handleEditorRequest } from '../../../server/http'
export const runtime = 'nodejs'
export const maxDuration = 120
export const POST = (request: Request) => handleEditorRequest(request, 'assemble')

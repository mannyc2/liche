export type ProjectGetInput = {
  projectId: string
  includeDeployments?: boolean
}

export type Project = {
  project: { id: string; name: string }
}

export async function getProject(input: ProjectGetInput): Promise<Project> {
  return {
    project: { id: input.projectId, name: `project-${input.projectId}` },
  }
}

export type ProjectDeployInput = {
  projectId: string
  target?: string
}

export type Deployment = {
  deploymentId: string
}

export async function deployProject(input: ProjectDeployInput): Promise<Deployment> {
  return { deploymentId: `dep-${input.projectId}-${input.target ?? 'preview'}` }
}

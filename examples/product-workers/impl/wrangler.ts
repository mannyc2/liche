export async function deploy(input: {
  entrypoint: string
  environment?: string | undefined
}): Promise<{ deployment_id: string; url?: string }> {
  const env = input.environment ?? 'preview'
  return {
    deployment_id: `dep-${input.entrypoint.replace(/[^a-zA-Z0-9]+/g, '-')}-${env}`,
    url: `https://${env}.workers.example.test`,
  }
}

export async function dev(input: {
  entrypoint: string
  port?: number | undefined
}): Promise<{ url: string }> {
  const port = input.port ?? 8787
  return { url: `http://localhost:${port}?entry=${encodeURIComponent(input.entrypoint)}` }
}


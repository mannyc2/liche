// Deterministic test handlers consumed by both the generated and handwritten
// CLI fixtures so runtime parity assertions can compare exact JSON envelopes.

export async function deploy(input: {
  entrypoint: string
  environment?: string | undefined
}): Promise<{ deployment_id: string; url?: string }> {
  const env = input.environment ?? 'preview'
  return { deployment_id: `dep-${input.entrypoint}-${env}`, url: `https://${env}.example.com` }
}

export async function dev(input: { entrypoint: string }): Promise<{ url: string }> {
  return { url: `http://localhost:8787?entry=${input.entrypoint}` }
}

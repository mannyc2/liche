import { Command, Field, Product, Shape } from '../../src/index.js'

// Minimal Product used by cli.test.ts and generate-check.test.ts to exercise
// the li-build CLI end-to-end. The workers fixture lands in commit 5; this
// inline product keeps commit 4 self-contained.
export default Product.create({
  id: 'sample',
  name: 'Sample',
  version: '0.1.0',
})
  .resource('script', { label: 'Script', path: '/scripts' }, (r) =>
    r
      .field('id', Field.string('Script ID').identifier().immutable())
      .field('name', Field.string('Script name').humanLabel())
      .operation('list', {
        summary: 'List scripts',
        http: { method: 'GET', path: '' },
        output: Shape.list('script'),
      }),
  )
  .command('dev', Command.local({ summary: 'Dev server', handler: 'sample.dev' }))

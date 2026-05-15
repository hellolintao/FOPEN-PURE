// Lightweight component logic test (without WeChat runtime)
let definition
global.Component = (def) => { definition = def }

require('../index')

test('empty-state defines required props', () => {
  expect(definition.properties).toBeDefined()
  expect(definition.properties.title).toBeDefined()
  expect(definition.properties.action).toBeDefined()
  expect(definition.properties.icon).toBeDefined()
  expect(definition.properties.subtitle).toBeDefined()
})

test('onActionTap triggers event "action"', () => {
  const ctx = { triggerEvent: jest.fn(), properties: { action: '查看' } }
  definition.methods.onActionTap.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('action')
})

test('attached lifecycle logs error when action prop missing', () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = { properties: { action: '' } }
  definition.lifetimes.attached.call(ctx)
  expect(errSpy).toHaveBeenCalled()
  errSpy.mockRestore()
})

test('attached does not log error when action present', () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = { properties: { action: '重试' } }
  definition.lifetimes.attached.call(ctx)
  expect(errSpy).not.toHaveBeenCalled()
  errSpy.mockRestore()
})

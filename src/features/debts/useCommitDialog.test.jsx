import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCommitDialog } from './useCommitDialog';

// A flow whose collaborators record the order they ran in.
const setup = (overrides = {}, calls = []) => {
  const flow = {
    createNonce: vi.fn().mockReturnValue('n1'),
    save: vi.fn(async () => { calls.push('save'); }),
    findSaved: vi.fn().mockResolvedValue(null),
    reload: vi.fn(async () => { calls.push('reload'); }),
    onRefresh: vi.fn(() => { calls.push('refresh'); }),
    onNotify: vi.fn(),
    successMessage: vi.fn(() => 'Guardado.'),
    alreadySaved: 'Ya estaba guardado.',
    ...overrides,
  };
  const hook = renderHook(() => useCommitDialog(flow));
  return { ...flow, calls, hook };
};
const submit = (hook, input) => act(() => hook.result.current.submit(input));
const open = (hook) => act(() => hook.result.current.open('ctx'));

describe('useCommitDialog afterSave', () => {
  it('runs after the reload and before the refresh, with the saved input and the dialog context', async () => {
    const calls = [];
    const afterSave = vi.fn(async () => { calls.push('afterSave'); return { created: 0, updated: 2, removed: 0 }; });
    const ctx = setup({ afterSave }, calls);
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'rate_change' });

    expect(ctx.calls).toEqual(['save', 'reload', 'afterSave', 'refresh']);
    expect(afterSave).toHaveBeenCalledWith({ input: { kind: 'rate_change' }, context: 'ctx' });
    expect(ctx.hook.result.current.dialog).toBeNull();
  });

  it('hands what afterSave resolved to the success message', async () => {
    const afterSave = vi.fn().mockResolvedValue({ created: 0, updated: 2, removed: 0 });
    const ctx = setup({ afterSave });
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'rate_change' });

    expect(ctx.successMessage).toHaveBeenCalledWith({ kind: 'rate_change' }, { value: { created: 0, updated: 2, removed: 0 } });
    expect(ctx.onNotify).toHaveBeenCalledWith('Guardado.');
  });

  it('keeps the save when afterSave fails: the dialog closes and the message hears about the failure', async () => {
    const failure = new Error('sin red');
    const afterSave = vi.fn().mockRejectedValue(failure);
    const ctx = setup({ afterSave });
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'rate_change' });

    expect(ctx.hook.result.current.dialog).toBeNull();
    expect(ctx.hook.result.current.saveState).toMatchObject({ status: 'idle', error: null });
    expect(ctx.successMessage).toHaveBeenCalledWith({ kind: 'rate_change' }, { error: failure });
    expect(ctx.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('is not run when the write failed', async () => {
    const afterSave = vi.fn();
    const ctx = setup({ afterSave, save: vi.fn().mockRejectedValue(new Error('Servidor no disponible')) });
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'rate_change' });

    expect(afterSave).not.toHaveBeenCalled();
    expect(ctx.hook.result.current.saveState).toMatchObject({ status: 'error', error: 'Servidor no disponible' });
  });

  it('also runs when an edited retry finds that the failed attempt had been saved', async () => {
    const afterSave = vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 });
    const ctx = setup({ afterSave, save: vi.fn().mockRejectedValueOnce(new Error('sin red')), findSaved: vi.fn().mockResolvedValue({ $id: 'x' }) });
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'rate_change', n: 1 });
    await submit(ctx.hook, { kind: 'rate_change', n: 2 });

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(afterSave).toHaveBeenCalledTimes(1);
    expect(ctx.onNotify).toHaveBeenLastCalledWith('Ya estaba guardado.');
  });

  it('leaves a flow without afterSave exactly as it was', async () => {
    const ctx = setup();
    await open(ctx.hook);
    await submit(ctx.hook, { kind: 'payment' });

    expect(ctx.calls).toEqual(['save', 'reload', 'refresh']);
    expect(ctx.successMessage).toHaveBeenCalledWith({ kind: 'payment' }, undefined);
  });
});

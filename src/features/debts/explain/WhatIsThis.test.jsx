import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DAY_10, MORA_DISBURSEMENT, makeMoraLoan } from '../debtFixtures';
import WhatIsThis from './WhatIsThis';
import { popoverOf } from './popoverModel';

const popover = () => popoverOf('mora', { debt: makeMoraLoan(), events: [MORA_DISBURSEMENT], today: DAY_10 });
const trigger = () => screen.getByRole('button', { name: '¿Qué es esto? Mora acumulada' });
const setup = (props = {}) => {
  const user = userEvent.setup();
  render(<WhatIsThis popover={popover()} subject="Mora acumulada" {...props} />);
  return user;
};

describe('WhatIsThis', () => {
  it('renders nothing without a popover', () => {
    const { container } = render(<WhatIsThis popover={null} subject="Mora acumulada" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is a collapsed disclosure that names the figure it explains', () => {
    setup();

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on tap with the title, the user figures, the reviewed copy, the source and the exact disclaimer', async () => {
    const user = setup();
    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Intereses de mora' });
    expect(within(dialog).getByText('Mora acumulada: $ 1.375 por 10 días de atraso sobre $ 199.505 de capital vencido.')).toBeInTheDocument();
    expect(within(dialog).getByText('Tasa de mora vigente: 28,59 % E.A.')).toBeInTheDocument();
    for (const paragraph of popover().paragraphs) expect(within(dialog).getByText(paragraph)).toBeInTheDocument();
    expect(within(dialog).getByText(popover().source)).toBeInTheDocument();
    expect(within(dialog).getByText('Información educativa con tus datos; no es asesoría financiera.')).toBeInTheDocument();
  });

  it('opens with Enter and closes with Escape, giving the focus back to the trigger', async () => {
    const user = setup();
    trigger().focus();
    await user.keyboard('{Enter}');

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  it('opens with Space', async () => {
    const user = setup();
    trigger().focus();
    await user.keyboard(' ');

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('closes when the trigger is tapped again', async () => {
    const user = setup();
    await user.click(trigger());
    await user.click(trigger());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

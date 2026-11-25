import { describe, expect, it } from '@jest/globals';

import { friendlyError } from '../errors';

describe('friendlyError', () => {
  const ROLE = "Your role in this lab can't make this change. Ask the lab's owner.";

  it('explains row-level security refusals in terms of roles', () => {
    expect(friendlyError('new row violates row-level security policy for table "strains"', '42501')).toBe(ROLE);
    expect(friendlyError('permission denied for table lab_settings', '42501')).toBe(ROLE);
  });

  it("keeps our own functions' messages, which already say what happened", () => {
    expect(friendlyError("Viewers can't change this lab", '42501')).toBe("Viewers can't change this lab");
    expect(friendlyError("Only the lab's owners can change lab settings", '42501')).toBe("Only the lab's owners can change lab settings");
    expect(friendlyError('Culture not found', 'P0002')).toBe('Culture not found');
  });

  it('turns plan limits into a sentence', () => {
    expect(friendlyError('limit_reached:strains:25', 'LM001')).toBe(
      "You've reached your plan's limit for strains (25). Remove one you no longer need, or ask the app's owner about a bigger plan.",
    );
    expect(friendlyError('limit_reached:labs_owned:1', 'LM001')).toContain('limit for labs you own (1)');
  });
});

# How to Structure Tickets for AI Agent Execution

Tickets written for human developers assume context and judgment. Tickets written for AI agents need to be explicit about the "what" and "why" while leaving the "how" to the agent.

## What goes IN the ticket

### Business context (always)

The agent needs to know WHY this change matters, not just what to change.

```markdown
## Business Context

Users who accidentally sell the wrong quantity of an item have no way
to correct the mistake. Their entire portfolio calculations become wrong
and the only workaround is to delete and re-add the item, losing all
history.
```

### User flow (for UX-facing features)

A simple numbered flow that describes the experience, not the implementation:

```markdown
## User Flow

1. User opens portfolio item detail
2. Taps "Sold" tab to see sold items
3. Taps "Edit" on a sold lot
4. Edit form opens pre-filled with current values
5. User changes the sale price
6. Taps "Save" — P&L recalculates immediately
```

### Acceptance criteria (always)

Clear, testable "done when" statements:

```markdown
## Acceptance Criteria

- [ ] User can edit sale price on a sold item
- [ ] User can edit sale date on a sold item
- [ ] P&L recalculates after edit
- [ ] Edit form pre-fills with current values
- [ ] Changes persist after app restart
```

### Test scenarios (always for non-trivial features)

What to test, not how to test:

```markdown
## Test Scenarios

Happy path:
- Edit price from 42.50 to 50.00 — verify P&L updates

Edge cases:
- Edit to zero price — should show error
- Edit date to future — should show warning
- Edit quantity to more than originally sold — should show error

Regression:
- Editing one sold lot should not affect other lots
- Portfolio total should update after edit
```

### Out of scope (when relevant)

Prevents the agent from gold-plating:

```markdown
## Out of Scope

- Bulk editing multiple sold items
- Reverting a sale (separate ticket)
- Export/download of sale history
```

## What should NOT be in the ticket

- **File paths** ("edit portfolio.service.ts line 250") — the agent knows the codebase
- **Implementation details** ("use a bottom sheet component") — let the agent decide
- **Technical architecture** ("create a new GraphQL mutation called UpdateSoldItem") — the agent will figure out the right approach
- **Copy-pasted code** — the agent can read the existing code

These constraints cause the agent to follow instructions blindly even when the codebase suggests a different approach.

## When to split into sub-tickets

Split when a feature has 3+ distinct, independently shippable pieces. Each sub-ticket should be mergeable on its own.

Example for "Sold Items Management":

```
SM-61a: API — edit sold record mutation + tests
SM-61b: Mobile — edit sold item form
SM-61c: Mobile — sold items tab on product detail
SM-61d: Mobile — portfolio-wide sold items view
```

Each gets its own business context, acceptance criteria, and test scenarios. Agents can work on them in parallel if they touch different parts of the codebase.

## Template

```markdown
# [Feature] Short description

## Business Context
What problem does this solve? Who is affected? How are they solving it today?

## User Flow
1. Step one
2. Step two
3. Step three

## Acceptance Criteria
- [ ] Criterion one
- [ ] Criterion two
- [ ] Criterion three

## Test Scenarios
Happy path:
- Scenario one
- Scenario two

Edge cases:
- Scenario one
- Scenario two

## Out of Scope
- Thing we're not doing
- Other thing we're not doing
```

## The golden rule

Write tickets that answer "what" and "why." Let the agent own "how."
The better your acceptance criteria, the less you need to micromanage the implementation.

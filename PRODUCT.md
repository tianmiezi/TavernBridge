# Product

## Register

product

## Users

The primary user is the local owner/operator of Codex Tavern Bridge. They use the console on their own machine while running SillyTavern, a WeChat bridge, scheduled automations, and local relay services.

They are usually trying to answer practical questions quickly: is the bridge online, which account or bot is active, what is queued or failed, which scheduled tasks will run today, and what needs to be edited before the next automation fires.

## Product Purpose

Codex Tavern Bridge is a local control surface for routing WeChat/OpenClaw messages into SillyTavern and sending generated replies back through WeChat. It also manages bot bindings, weekly trigger schedules, random check-ins, follow-up reminders, delivery modes, queue recovery, and broader calendar context for both the user and the character.

Success means the operator can understand system state at a glance, edit routing and automation settings without friction, plan schedules that drive character behavior, and troubleshoot failures without reading raw files first. The console should remain extensible as new features, platforms, queues, calendar sources, and backend interfaces are added.

## Brand Personality

Orderly, readable, dependable.

The interface should feel like a well-made backend control page: calm, organized, and practical, with enough visual craft to feel pleasant during repeated daily use. It should favor clarity over drama and useful density over decoration.

## Anti-references

This should not look like a marketing landing page, a decorative dashboard mockup, a cyberpunk terminal, or a wall of identical cards. Avoid flashy gradients, ornamental effects, hidden primary actions, vague status labels, and layouts that collapse when new modules are added.

## Design Principles

1. State first: the most important service, account, queue, and task health should be visible before configuration details.
2. Calendar is context: weekly triggers, user agenda, and character agenda should be treated as a first-class planning surface, not as incidental task metadata.
3. Edit in context: configuration should live near the thing it affects, with clear current values and predictable save behavior.
4. Scale by modules: new platforms, interfaces, queues, calendar sources, and task types should fit into named sections without forcing a full layout rewrite.
5. Recovery is a workflow: failed, deferred, and pending items should be easy to inspect, retry, clear, or leave alone with confidence.
6. Quiet confidence: the UI should be beautiful through alignment, typography, spacing, and hierarchy, not through decorative noise.

## Accessibility & Inclusion

Optimize for readability, stable layout, and keyboard-friendly operation. Use visible focus states, clear labels, adequate contrast, responsive layouts for narrower windows, and avoid relying on color alone to communicate state. Motion should be subtle and nonessential, with reduced-motion support.

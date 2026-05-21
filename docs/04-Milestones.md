# Milestones

Disburse supports Milestone Invoice Chains for complex billing arrangements.

## Overview

Milestone Invoice Chains are multi-step invoice sequences. Each payment step unlocks only when the previous step's Portable Settlement Proof (PSP) is presented and verified.

## Use Cases

* **Freelancer milestone payments**: Design step, development step, and deployment step.
* **SLA-backed service billing**: Billing triggered by meeting service level agreements.
* **Escrow-style conditional releases**: Funds are released as conditions are met.
* **Agent-to-agent task completion proofs**: AI agents can prove task completion and receive payment before starting the next task.

## How It Works

1. A creator defines a chain of steps with specific amounts.
2. The first step is unlocked immediately.
3. The payer settles the first step, generating a PSP.
4. The PSP is presented to unlock the second step.
5. This process continues until all steps are completed.

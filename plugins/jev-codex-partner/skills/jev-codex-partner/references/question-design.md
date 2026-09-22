# Question design

## Provider mechanics

Use the local TypeSafe JEV partner tool and its final `evaluate` input/result contract. Select one typed mode: Boolean, Choice or Score. Keep the question bounded, name the alternatives or rubric, and provide only the minimal state needed to evaluate it. Automatic discovery is enabled for this guidance; do not add an explicit-only routing policy.

Ask one bounded question or a bounded batch of independent questions at a time. State the relevant context, each decision criterion and any allowed options. For a Boolean question, define what yes and no mean. For Choice, provide a finite set of labelled options. For Score, define the scale and rubric anchors. Do not ask JEV to draft content, investigate sources, perform calculations or make a plan.

## Question examples

- Boolean: “Given these supplied acceptance criteria, does this candidate satisfy every criterion?”
- Choice: “Which of these three routing queues best matches the supplied request: billing, access or technical support?”
- Score: “Using this supplied rubric from 0 to 4, how well does the proposal meet the stated safety criteria?”

Briefly explain why the typed JEV evaluation fits before calling the tool. Treat the response as advisory-only and report only the reasoning or evidence actually returned by JEV. A probability is not a universal confidence threshold and does not replace human review.

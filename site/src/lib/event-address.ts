/**
 * Where an Event's page is. An Annotation of kind `event` names the content record behind it
 * (`ref`: `content/events/{id}.md`, release contract 0.3.0); the page is `/events/{id}`.
 */
const ID = "[0-9]{4}(?:-[0-9]{2}(?:-[0-9]{2})?)?-[a-z0-9]+(?:-[a-z0-9]+)*";
const REF = new RegExp(`^content/events/(${ID})\\.md$`);
const EVENT_ID = new RegExp(`^${ID}$`);

export const isEventId = (id: string): boolean => id.length <= 100 && EVENT_ID.test(id);

/** The id of the Event an Annotation's `ref` names, or null when it names none. */
export function eventIdOf(ref: string | null | undefined): string | null {
  const id = ref ? (REF.exec(ref)?.[1] ?? null) : null;
  return id !== null && isEventId(id) ? id : null;
}

/** The page of the Event an Annotation's `ref` names, without the base path, or null. */
export function eventPath(ref: string | null | undefined): string | null {
  const id = eventIdOf(ref);
  return id === null ? null : `/events/${id}`;
}

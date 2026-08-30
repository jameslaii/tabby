"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createGroup } from "../../../../lib/db";
import { CURRENCIES, DEFAULT_CURRENCY } from "../../../../lib/currencies";
import { useStore } from "../../../../components/StoreProvider";

/**
 * Starting a group is where the names get entered.
 *
 * The old flow made a group from a name alone and dropped you on its page with
 * one member — yourself — where every split was between you and nobody. Asking
 * for the people here is the difference between a group you can use and one
 * you have to go and repair.
 */

const EMOJI = ["🍜", "✈️", "🏠", "🎉", "🏝️", "⛷️", "🍻", "🎬", "🚗", "🎂"];

export default function NewGroupPage() {
  const router = useRouter();
  const { update, ready } = useStore();

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [people, setPeople] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  function addPerson() {
    const person = draft.trim();
    if (!person) return;

    if (person.toLowerCase() === "you" || person.toLowerCase() === "me") {
      setNote("You're already in the group — add the others by name.");
      setDraft("");
      return;
    }
    if (people.some((p) => p.toLowerCase() === person.toLowerCase())) {
      // Two members with the same name can't be told apart when a receipt
      // says "Sam had the salmon", so the split flags it rather than guessing.
      setNote(`${person} is already on the list.`);
      setDraft("");
      return;
    }

    setPeople((current) => [...current, person]);
    setDraft("");
    setNote(null);
  }

  function create() {
    if (!name.trim()) {
      setNote("Give the group a name.");
      nameField.current?.focus();
      return;
    }

    // A name still sitting in the box is one the person meant to add.
    const names = draft.trim() ? [...people, draft.trim()] : people;

    const { group } = update((db) =>
      createGroup(db, { name, emoji, memberNames: names, currency }),
    );
    router.push(`/groups/${group.id}`);
  }

  return (
    <main className="space-y-5 pt-5">
      <div>
        <h1 className="display-sm">Start a group</h1>
        <p className="lede mt-1.5 text-[14px]">
          A trip, a flat, a standing dinner — anywhere money gets shared.
        </p>
      </div>

      <section className="card space-y-4">
        <div>
          <label className="label" htmlFor="group-name">
            What&rsquo;s it for?
          </label>
          <div className="flex gap-2">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              aria-label="Group emoji"
              className="field w-16 text-center text-xl"
            />
            <input
              id="group-name"
              ref={nameField}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder="Lisbon trip, flatmates, book club…"
              className="field flex-1"
              autoFocus
            />
          </div>
          <div className="mt-4">
            <label className="label" htmlFor="group-currency">
              Currency
            </label>
            <select
              id="group-currency"
              className="field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} &mdash; {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink/45">
              Every expense in this group is in this currency. It can&rsquo;t be
              changed once there are expenses.
            </p>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EMOJI.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setEmoji(option)}
                aria-label={`Use ${option}`}
                className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition ${
                  emoji === option
                    ? "bg-ink text-white"
                    : "bg-ink/5 hover:bg-ink/10"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <div>
          <div className="label">Who&rsquo;s in it?</div>
          <p className="-mt-1 mb-3 text-xs text-ink/45">
            Everyone you&rsquo;ll be splitting with. They don&rsquo;t need an
            account — you can add more later.
          </p>
        </div>

        <ul className="flex flex-wrap gap-2">
          <li className="chip bg-teal/10 text-teal">
            You
            <span className="text-[10px] opacity-60">that&rsquo;s you</span>
          </li>
          {people.map((person) => (
            <li key={person} className="chip bg-paper/60 text-ink/75">
              {person}
              <button
                type="button"
                onClick={() =>
                  setPeople((current) => current.filter((p) => p !== person))
                }
                aria-label={`Remove ${person}`}
                className="ml-0.5 text-ink/35 transition hover:text-ginger-dark"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 60))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPerson();
              }
            }}
            placeholder="Add someone by name"
            aria-label="Add someone by name"
            className="field flex-1"
          />
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={addPerson}
            disabled={!draft.trim()}
          >
            Add
          </button>
        </div>

        {note && <p className="text-sm text-ginger-dark">{note}</p>}

        {people.length === 0 && (
          <p className="text-xs text-ink/45">
            A group of one can&rsquo;t split anything — add at least one other
            person.
          </p>
        )}
      </section>

      <button
        className="btn-primary w-full py-3.5"
        onClick={create}
        disabled={!ready || !name.trim()}
      >
        Create group
        {people.length > 0 &&
          ` with ${people.length + 1} ${people.length === 0 ? "person" : "people"}`}
      </button>
    </main>
  );
}

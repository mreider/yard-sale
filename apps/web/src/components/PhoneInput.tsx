import { useEffect, useId, useState } from 'react';
import { COUNTRIES, type Country, flag, parseE164 } from '../lib/countries.js';

const byIso = new Map<string, Country>(COUNTRIES.map((c) => [c.iso2, c]));

/**
 * Country-picker + national-number input. Emits an E.164-formatted
 * string (`+15125551234`) via onChange. Parses any incoming E.164
 * value so re-editing works. Empty string → empty national field
 * (country stays at last selection or US default).
 */
export function PhoneInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
}) {
  const selectId = useId();
  const parsed = parseE164(value);
  const [iso2, setIso2] = useState(parsed.iso2);
  const [national, setNational] = useState(parsed.national);

  // Re-sync when the parent replaces the value (e.g. on reload).
  useEffect(() => {
    const p = parseE164(value);
    setIso2(p.iso2);
    setNational(p.national);
  }, [value]);

  const country = byIso.get(iso2) ?? byIso.get('US')!;

  function emit(nextIso2: string, nextNational: string) {
    if (!nextNational) {
      onChange('');
      return;
    }
    const c = byIso.get(nextIso2) ?? country;
    onChange(`+${c.dial}${nextNational}`);
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select
        id={selectId}
        aria-label="Country"
        value={iso2}
        onChange={(e) => {
          setIso2(e.target.value);
          emit(e.target.value, national);
        }}
        style={{ flexShrink: 0, maxWidth: 180 }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso2} value={c.iso2}>
            {flag(c.iso2)} +{c.dial} · {c.name}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        value={national}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          setNational(digits);
          emit(iso2, digits);
        }}
        placeholder={placeholder ?? '5125551234'}
        style={{ flex: 1, minWidth: 0 }}
      />
    </div>
  );
}

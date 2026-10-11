/** Typeset only recognized saved expressions; unknown formulas retain their exact text. */
export function SavedFormula({ value }: { value: string }) {
  const adiabatic = value === 'I_AD=K S √{ln[(θ_f+β)/(θ_i+β)]/t}';
  return <p className="type-saved-formula" data-saved-formula title={value}>
    {adiabatic ? <>I<sub>AD</sub> = K·S·√( ln((θ<sub>f</sub>+β)/(θ<sub>i</sub>+β)) / t )</> : value === 'I=ε I_AD' ? <>I = ε·I<sub>AD</sub></> : value}
  </p>;
}

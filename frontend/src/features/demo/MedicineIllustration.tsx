export function MedicineIllustration({ token, code }: { token: string; code: string }) {
  return <svg viewBox="0 0 240 180" className={`md-medicine-art md-medicine-art--${token}`} aria-hidden="true">
    <ellipse cx="124" cy="146" rx="76" ry="11" fill="currentColor" opacity=".08" />
    {token === 'tablet' ? <><rect x="59" y="35" width="122" height="100" rx="12" fill="currentColor" opacity=".12" /><g fill="none" stroke="currentColor" strokeWidth="2">{[0, 1, 2].map(x => [0, 1].map(y => <ellipse key={`${x}-${y}`} cx={84 + x * 36} cy={64 + y * 39} rx="11" ry="14" />))}</g></> : token === 'capsule' ? <g transform="rotate(-28 120 88)"><rect x="46" y="62" width="148" height="53" rx="26.5" fill="currentColor" opacity=".15" /><rect x="46" y="62" width="148" height="53" rx="26.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M120 62v53" stroke="currentColor" strokeWidth="2" /></g> : token === 'ointment' ? <><path d="M74 40h92l-13 85H87Z" fill="currentColor" opacity=".16" /><path d="M74 40h92l-13 85H87ZM92 125v17h56v-17M83 59h74M100 86h40" fill="none" stroke="currentColor" strokeWidth="2" /></> : <><rect x="99" y="25" width="42" height="25" rx="5" fill="currentColor" opacity=".25" /><path d="M97 50h46l17 20v68H80V70Z" fill="currentColor" opacity=".12" /><path d="M97 50h46l17 20v68H80V70ZM80 83h80M100 100h40m-40 12h27" fill="none" stroke="currentColor" strokeWidth="2" />{token === 'drops' && <path d="M179 79s13 16 13 23a13 13 0 0 1-26 0c0-7 13-23 13-23Z" fill="currentColor" opacity=".2" />}</>}
    <text x="120" y="169" textAnchor="middle" fill="currentColor" fontSize="9" letterSpacing="2">{code} · ILLUSTRATION</text>
  </svg>;
}

export function MedicineCatalogHero() {
  return <section className="cc-market-hero" aria-label="Fictional medicine reference library">
    <svg className="cc-market-campus" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="medicine-library-sky" x2="1" y2="1"><stop stopColor="#a6a2df" /><stop offset="1" stopColor="#49498c" /></linearGradient></defs>
      <path fill="url(#medicine-library-sky)" d="M0 0h1200v400H0Z" /><circle cx="930" cy="85" r="155" fill="#ded2f6" opacity=".22" />
      <g fill="#c2b8d9"><rect x="740" y="117" width="97" height="203" rx="16" /><rect x="755" y="80" width="67" height="38" rx="7" /><rect x="884" y="162" width="86" height="158" rx="10" /><path d="M1010 145h112l-16 174h-80Z" /><rect x="595" y="190" width="104" height="130" rx="9" /></g>
      <g fill="none" stroke="#514b7f" strokeWidth="8" opacity=".8"><path d="M740 179h97m-77 53h57m-57 28h42M900 194h54m-54 28h40M1033 186h65m-60 32h50M611 218h72m-72 29h51" /></g>
      <path d="M420 325h760v17H420Z" fill="#ded2f6" opacity=".35" /><path d="M0 400V360Q320 290 620 360T1200 340v60Z" fill="#343e66" />
    </svg>
    <div className="cc-market-hero-copy"><p className="cc-market-hero-eyebrow">Your medicine guide</p><h2>Explore examples.<br />Understand the details.</h2><p>Browse fictional ingredients, formulations and reference layouts. Built for learning, not treatment decisions.</p></div>
  </section>;
}

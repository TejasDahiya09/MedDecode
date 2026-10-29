// Static artwork selected from CampusConnect LoginKineticRibbon; motion/services omitted.
export function AuthRibbon() {
  return <div className="cc-login-ribbon" aria-hidden="true">
      <span className="cc-login-ribbon-aura" />
      <svg focusable="false" viewBox="0 0 720 320">
        <defs>
          <linearGradient id="login-ribbon-primary" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="0.5" stopColor="#6366f1" />
            <stop offset="1" stopColor="#4338ca" />
          </linearGradient>
          <linearGradient id="login-ribbon-secondary" x1="0" x2="1">
            <stop offset="0" stopColor="#c4b5fd" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="#8b5cf6" stopOpacity="0.82" />
            <stop offset="1" stopColor="#67e8f9" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="login-ribbon-light" x1="0" x2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.62" />
            <stop offset="1" stopColor="#a5f3fc" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--back">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--back">
            <path d="M54 229C151 279 226 259 296 176C379 79 472 60 666 122C511 111 432 144 361 225C285 312 176 302 54 229Z">

            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--middle">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--main">
            <path d="M45 201C162 94 259 74 352 145C436 209 514 221 675 147C558 262 437 282 337 208C248 142 164 147 45 201Z">

            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--middle">
          <g className="cc-login-ribbon-layer cc-login-ribbon-layer--fold">
            <path d="M169 221C252 133 312 113 381 151C445 187 500 187 585 142C508 225 420 247 347 207C286 173 235 177 169 221Z">

            </path>
          </g>
        </g>
        <g className="cc-login-ribbon-depth cc-login-ribbon-depth--front">
          <path
            className="cc-login-ribbon-highlight"
            d="M78 194C178 113 263 101 350 159C438 217 521 214 641 158"
            pathLength="100"
          >

          </path>
        </g>
      </svg>
  </div>;
}

package platform

import (
	"net/http"
	"strconv"
	"strings"
)

// CORS is a minimal cross-origin middleware.
//
// Why it exists at all: in development the browser app runs on :3000 and the API on
// :8080, which are different origins. Without these headers the browser blocks every
// request before it leaves the tab. curl does not enforce CORS, which is exactly why
// this can pass every command-line check and still show an empty screen.
//
// In production the reverse proxy serves both from one origin and this middleware is a
// no-op — configure CORS_ORIGINS empty and set Access-Control-Allow-Origin to nothing.
type CORS struct {
	allowed map[string]bool
}

func NewCORS(origins string) *CORS {
	allowed := map[string]bool{}
	for _, origin := range strings.Split(origins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = true
		}
	}
	return &CORS{allowed: allowed}
}

// Middleware answers preflights and stamps the allow header on real requests.
//
// Credentials are deliberately NOT allowed: the API authenticates with a bearer token,
// never a cookie, and per spec `Access-Control-Allow-Origin: *` is incompatible with
// credentials anyway. Sending one would be a false promise.
func (c *CORS) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// A same-origin or non-browser request has no Origin header; do not add CORS
		// headers to it, so a reverse proxy in front of us stays authoritative.
		if origin == "" || len(c.allowed) == 0 {
			next.ServeHTTP(w, r)
			return
		}

		if !c.allowed[origin] {
			// Deliberately no CORS headers on rejection. The browser then blocks it and
			// reports a generic network error, which is the right level of detail.
			if r.Method != http.MethodOptions {
				next.ServeHTTP(w, r)
			}
			return
		}

		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Add("Vary", "Origin")
		h.Set("Access-Control-Expose-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
			// Browsers cap preflight caching; 10 minutes is well inside every limit and
			// cuts preflights by roughly half on a chatty UI.
			h.Set("Access-Control-Max-Age", strconv.Itoa(600))
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

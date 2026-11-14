// Hu's Noodle Nook — progressive enhancements. The page is complete without this file.
(() => {
  "use strict";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SHORT = { Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };

  const fmt = (hhmm) => {
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
  };
  const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  // Current weekday + minutes in Edmonton, whatever the viewer's own time zone.
  function edmontonNow() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Edmonton", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return { day: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  }

  // ---- open / closed status + today's row ----
  const status = document.getElementById("open-status");
  if (status) {
    let hours = [];
    try { hours = JSON.parse(status.dataset.hours); } catch { hours = []; }
    const byDay = Object.fromEntries(hours.map((h) => [h.day, h]));
    const update = () => {
      const now = edmontonNow();
      const today = byDay[now.day];
      let state = "closed", text = "";
      if (today && !today.closed && now.minutes >= mins(today.open) && now.minutes < mins(today.close)) {
        const left = mins(today.close) - now.minutes;
        state = left <= 30 ? "soon" : "open";
        text = left <= 30 ? `Closing soon · kitchen closes at ${fmt(today.close)}` : `Open now · until ${fmt(today.close)} today`;
      } else {
        const idx = DAYS.indexOf(now.day);
        for (let i = 0; i < 8; i++) {
          const d = DAYS[(idx + i) % 7];
          const h = byDay[d];
          if (!h || h.closed) continue;
          if (i === 0 && now.minutes >= mins(h.open)) continue;
          text = i === 0 ? `Closed now · opens today at ${fmt(h.open)}` : i === 1 ? `Closed now · opens tomorrow at ${fmt(h.open)}` : `Closed now · opens ${SHORT[d]} at ${fmt(h.open)}`;
          break;
        }
      }
      if (text) {
        status.dataset.state = state;
        status.querySelector(".status__text").textContent = text;
      }
      document.querySelectorAll("#hours tr").forEach((tr) => tr.classList.toggle("is-today", tr.dataset.day === now.day));
    };
    update();
    setInterval(update, 60_000);
  }

  // ---- Find your bowl ----
  const picker = document.getElementById("picker");
  const picks = [...document.querySelectorAll("#picks .pick")];
  const count = document.getElementById("picker-count");
  const LABEL = { all: "all", rich: "rich & creamy", light: "light & clear", spicy: "spicy", vegetarian: "vegetarian", nopork: "no-pork-listed" };
  function applyFilter(f) {
    let n = 0;
    picks.forEach((li) => {
      const show = f === "all" || li.dataset.traits.split(" ").includes(f);
      li.hidden = !show;
      if (show) n++;
    });
    picker.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.filter === f)));
    count.textContent = f === "all" ? `Showing all ${n} bowls` : `${n} ${LABEL[f]} bowl${n === 1 ? "" : "s"}`;
    try { localStorage.setItem("hnn-bowl-filter", f); } catch {}
  }
  if (picker) {
    picker.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (b) applyFilter(b.dataset.filter);
    });
    // Arrow-key support for the radiogroup.
    picker.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      const btns = [...picker.querySelectorAll("button")];
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = btns[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length];
      next.focus();
      applyFilter(next.dataset.filter);
    });
    let saved = "all";
    try { saved = localStorage.getItem("hnn-bowl-filter") || "all"; } catch {}
    applyFilter(LABEL[saved] ? saved : "all");
  }

  // ---- highlight the menu section in view ----
  const tabLinks = [...document.querySelectorAll(".menu-tabs a")];
  if ("IntersectionObserver" in window && tabLinks.length) {
    const map = new Map(tabLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        tabLinks.forEach((a) => a.removeAttribute("aria-current"));
        const a = map.get(en.target.id);
        if (a) {
          a.setAttribute("aria-current", "true");
          const ul = a.closest("ul");
          const li = a.parentElement;
          ul.scrollLeft = li.offsetLeft - (ul.clientWidth - li.offsetWidth) / 2;
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    document.querySelectorAll(".menu-cat").forEach((s) => io.observe(s));
  }
})();

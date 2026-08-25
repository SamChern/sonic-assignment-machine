/**
 * SonicSIM tracking tag.
 *
 * Install once per site, then send KPI events:
 *   <script src="https://sonicsimai.com/ss-pixel.js" data-tag="SS-XXXXXXXXXX"></script>
 *   <script>ssq('event', 'video_complete', { kpi_metric: 'vcr', kpi_value: 1, external_user_id: 'u_1002' });</script>
 */
(function () {
  var script = document.currentScript;
  var tag = script && script.getAttribute("data-tag");
  var endpoint =
    (script && script.getAttribute("data-endpoint")) ||
    "https://bskltmvfxolwhnfpsmno.supabase.co/functions/v1/pixel-collect";

  function send(eventName, opts) {
    if (!tag) return;
    opts = opts || {};
    var payload = {
      tag_id: tag,
      event_name: eventName || "page_view",
      external_user_id: opts.external_user_id || null,
      kpi_metric: opts.kpi_metric || null,
      kpi_value: opts.kpi_value === undefined ? null : opts.kpi_value,
      page_url: location.href,
      referrer: document.referrer || null,
      props: opts.props || {},
    };
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
    } catch (e) {
      /* fall through to fetch */
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  window.ssq = function (command, name, opts) {
    if (command === "event") send(name, opts);
    if (command === "pageview") send("page_view", name || {});
  };

  send("page_view", {});
})();

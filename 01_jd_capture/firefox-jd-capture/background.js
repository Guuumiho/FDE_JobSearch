function safeFileName(value) {
  return (value || "job-detail")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "job-detail";
}

browser.runtime.onMessage.addListener((message) => {
  if (!message) {
    return undefined;
  }

  if (message.type === "saveJobToLocal") {
    return fetch("http://127.0.0.1:8765/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.job)
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `local service returned ${response.status}`);
      }
      return data;
    });
  }

  if (message.type !== "downloadJobText") {
    return undefined;
  }

  const blob = new Blob([message.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = `JD-${safeFileName(message.title)}-${new Date().toISOString().slice(0, 10)}.txt`;

  return browser.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  }).finally(() => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
});

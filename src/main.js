import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

const tellButton = document.querySelector("#tell-button");
const stopButton = document.querySelector("#stop-button");
const nextButton = document.querySelector("#next-button");
const statusText = document.querySelector("#status-text");
const statusIndicator = document.querySelector("#status-indicator");
const storyList = document.querySelector("#story-list");
const resultCount = document.querySelector("#result-count");
const mapCaption = document.querySelector("#map-caption-text");
const mapCoordinates = document.querySelector("#map-coordinates");

const map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
}).setView([64.2, 11.0], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap-bidragsytere",
}).addTo(map);

let locationMarker;
let activeRequest;
let runId = 0;
let articles = [];
let currentStoryIndex = -1;
let speechSequence = 0;

function setStatus(message, state = "idle") {
  statusText.textContent = message;
  statusIndicator.dataset.state = state;
}

function highlightStory(index) {
  storyList.querySelectorAll(".story-item").forEach((item, itemIndex) => {
    const isCurrent = itemIndex === index;
    item.classList.toggle("is-speaking", isCurrent);
    item.querySelector(".story-now").hidden = !isCurrent;
    if (isCurrent) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  });
}

function renderArticles(items) {
  articles = items;
  currentStoryIndex = -1;
  nextButton.disabled = true;
  resultCount.textContent = items.length
    ? `${String(items.length).padStart(2, "0")} HISTORIER`
    : "INGEN TREFF";
  storyList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent =
      "Ingen artikler ble funnet i nærheten. Prøv igjen et annet sted.";
    storyList.append(empty);
    return;
  }

  items.forEach((article, index) => {
    const item = document.createElement("li");
    item.className = "story-item";
    const number = document.createElement("span");
    number.className = "story-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const details = document.createElement("div");
    details.className = "story-details";
    const title = document.createElement("a");
    title.href = `https://no.wikipedia.org/wiki/${encodeURIComponent(article.title.replaceAll(" ", "_"))}`;
    title.target = "_blank";
    title.rel = "noreferrer";
    title.textContent = article.title;
    const now = document.createElement("span");
    now.className = "story-now";
    now.textContent = "LESER NÅ";
    now.hidden = true;
    const distance = document.createElement("span");
    distance.className = "story-distance";
    distance.textContent =
      article.dist < 1000
        ? `${Math.round(article.dist)} M UNNA`
        : `${(article.dist / 1000).toFixed(1).replace(".", ",")} KM UNNA`;
    details.append(title, now, distance);
    item.append(number, details);
    storyList.append(item);
  });
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Denne nettleseren støtter ikke posisjonstjenester."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        const messages = {
          1: "Du må tillate posisjonstilgang for å finne historier i nærheten.",
          2: "Posisjonen kunne ikke fastslås. Sjekk enhetens posisjonstjenester.",
          3: "Det tok for lang tid å finne posisjonen. Prøv igjen.",
        };
        reject(
          new Error(messages[error.code] ?? "Kunne ikke hente posisjonen."),
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

async function fetchNearbyArticles(latitude, longitude, signal) {
  const searchUrl = new URL("https://no.wikipedia.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${latitude}|${longitude}`,
    gsradius: "10000",
    gslimit: "8",
    gsrnamespace: "0",
    format: "json",
    origin: "*",
  });

  const searchResponse = await fetch(searchUrl, { signal });
  if (!searchResponse.ok)
    throw new Error("Wikipedia svarte ikke. Kontroller internettforbindelsen.");
  const searchData = await searchResponse.json();
  const nearby = searchData.query?.geosearch ?? [];
  if (!nearby.length) return [];

  const detailUrl = new URL("https://no.wikipedia.org/w/api.php");
  detailUrl.search = new URLSearchParams({
    action: "query",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exchars: "700",
    titles: nearby.map((place) => place.title).join("|"),
    format: "json",
    origin: "*",
  });

  const detailResponse = await fetch(detailUrl, { signal });
  if (!detailResponse.ok)
    throw new Error("Kunne ikke hente artiklene fra Wikipedia.");
  const detailData = await detailResponse.json();
  const pages = Object.values(detailData.query?.pages ?? {});
  const extractsByTitle = new Map(
    pages.map((page) => [page.title, page.extract ?? ""]),
  );

  return nearby
    .map((place) => ({
      ...place,
      extract: extractsByTitle.get(place.title) ?? "",
    }))
    .filter((place) => place.extract.trim())
    .slice(0, 5);
}

function speakStoryAt(items, currentRun, index) {
  if (currentRun !== runId) return;
  if (index >= items.length) {
    currentStoryIndex = -1;
    highlightStory(-1);
    nextButton.disabled = true;
    stopButton.disabled = true;
    setStatus("Ferdig. Trykk Fortell for å høre historiene igjen.", "done");
    return;
  }

  currentStoryIndex = index;
  nextButton.disabled = index >= items.length - 1;
  const sequence = ++speechSequence;
  const article = items[index];
  const voices = window.speechSynthesis.getVoices();
  const norwegianVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith("nb")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("no"));
  const excerpt = article.extract.replace(/\s+/g, " ").trim();
  const utterance = new SpeechSynthesisUtterance(
    `${article.title}. ${excerpt}`,
  );
  utterance.lang = "nb-NO";
  if (norwegianVoice) utterance.voice = norwegianVoice;
  utterance.onstart = () => {
    if (currentRun === runId && sequence === speechSequence) {
      highlightStory(index);
      setStatus(
        `Leser ${article.title} (${index + 1} av ${items.length}) …`,
        "speaking",
      );
    }
  };
  utterance.onend = () => {
    if (currentRun === runId && sequence === speechSequence) {
      highlightStory(-1);
      speakStoryAt(items, currentRun, index + 1);
    }
  };
  utterance.onerror = (event) => {
    if (
      currentRun === runId &&
      sequence === speechSequence &&
      event.error !== "canceled" &&
      event.error !== "interrupted"
    ) {
      currentStoryIndex = -1;
      highlightStory(-1);
      nextButton.disabled = true;
      stopButton.disabled = true;
      setStatus("Opplesingen ble avbrutt av nettleseren.", "error");
    }
  };
  window.speechSynthesis.speak(utterance);
}

function speakStories(items, currentRun) {
  const voices = window.speechSynthesis.getVoices();
  const norwegianVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith("nb")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("no"));
  const sequence = ++speechSequence;
  const introduction = new SpeechSynthesisUtterance(
    `Her er noen historier fra området rundt deg. ${items.length} steder er funnet.`,
  );
  introduction.lang = "nb-NO";
  if (norwegianVoice) introduction.voice = norwegianVoice;
  introduction.onstart = () => {
    if (currentRun === runId && sequence === speechSequence) {
      setStatus("Leser introduksjonen …", "speaking");
    }
  };
  introduction.onend = () => {
    if (currentRun === runId && sequence === speechSequence) {
      speakStoryAt(items, currentRun, 0);
    }
  };
  introduction.onerror = (event) => {
    if (
      currentRun === runId &&
      sequence === speechSequence &&
      event.error !== "canceled" &&
      event.error !== "interrupted"
    ) {
      setStatus("Opplesing er ikke tilgjengelig i denne nettleseren.", "error");
      nextButton.disabled = true;
      stopButton.disabled = true;
    }
  };
  window.speechSynthesis.speak(introduction);
}

function skipCurrentStory() {
  if (currentStoryIndex < 0 || currentStoryIndex >= articles.length - 1) return;
  const nextIndex = currentStoryIndex + 1;
  speechSequence += 1;
  highlightStory(-1);
  window.speechSynthesis.cancel();
  speakStoryAt(articles, runId, nextIndex);
}

async function tellHistory() {
  const currentRun = ++runId;
  speechSequence += 1;
  currentStoryIndex = -1;
  nextButton.disabled = true;
  activeRequest?.abort();
  window.speechSynthesis.cancel();
  activeRequest = new AbortController();
  tellButton.disabled = true;
  stopButton.disabled = false;
  renderArticles([]);
  resultCount.textContent = "SØKER …";
  setStatus("Finner posisjonen din …", "loading");

  try {
    const position = await getPosition();
    if (currentRun !== runId) return;
    const { latitude, longitude } = position.coords;
    map.setView([latitude, longitude], 14, { animate: true });
    if (locationMarker) locationMarker.remove();
    locationMarker = L.circleMarker([latitude, longitude], {
      radius: 9,
      color: "#fffdf7",
      weight: 4,
      fillColor: "#d3563b",
      fillOpacity: 1,
    }).addTo(map);
    mapCaption.textContent = "DITT OMRÅDE";
    mapCoordinates.textContent = `${latitude.toFixed(4)}° N  ·  ${longitude.toFixed(4)}° Ø`;
    setStatus("Leter etter steder med en historie …", "loading");

    const found = await fetchNearbyArticles(
      latitude,
      longitude,
      activeRequest.signal,
    );
    if (currentRun !== runId) return;
    renderArticles(found);
    if (!found.length) {
      setStatus(
        "Fant ingen artikler i nærheten. Prøv igjen et annet sted.",
        "done",
      );
      stopButton.disabled = true;
      return;
    }
    setStatus(
      `${found.length} historier funnet. Gjør klar stemmen …`,
      "loading",
    );
    speakStories(found, currentRun);
  } catch (error) {
    if (currentRun !== runId || error.name === "AbortError") return;
    setStatus(error.message || "Noe gikk galt. Prøv igjen.", "error");
    stopButton.disabled = true;
    nextButton.disabled = true;
    resultCount.textContent = "INGEN TREFF";
  } finally {
    if (currentRun === runId) tellButton.disabled = false;
  }
}

function stopHistory() {
  runId += 1;
  speechSequence += 1;
  activeRequest?.abort();
  window.speechSynthesis.cancel();
  currentStoryIndex = -1;
  highlightStory(-1);
  tellButton.disabled = false;
  stopButton.disabled = true;
  nextButton.disabled = true;
  setStatus(
    articles.length ? "Opplesingen er stoppet." : "Søket er stoppet.",
    "idle",
  );
}

tellButton.addEventListener("click", tellHistory);
stopButton.addEventListener("click", stopHistory);
nextButton.addEventListener("click", skipCurrentStory);

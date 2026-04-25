import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firebase-client.js";

const CODE_PREFIX = {
  fifa: "F",
  sinuca: "S",
  cs: "C"
};

export function getCodePrefixByType(type) {
  return CODE_PREFIX[type] || "F";
}

export function normalizeTournamentCode(code) {
  return (code || "").replace(/\s+/g, "").toUpperCase();
}

export function isTournamentCodeValid(code) {
  return /^[FSC]\d{4}$/.test(code);
}

async function codeExists(code) {
  const snap = await getDoc(doc(db, "tournaments", code));
  return snap.exists();
}

export async function generateTournamentCode(type, maxAttempts = 30) {
  const prefix = getCodePrefixByType(type);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const randomDigits = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const code = `${prefix}${randomDigits}`;

    if (!(await codeExists(code))) {
      return code;
    }
  }

  throw new Error("Não foi possível gerar um código único. Tente novamente.");
}

export function buildTournamentPayload({
  code,
  type,
  name,
  participants = [],
  groups = [],
  knockout = [],
  repechage = [],
  ranking = [],
  status = "active",
  maxParticipants = 8,
  format = "groups_knockout"
}) {
  return {
    id: code,
    code,
    type,
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status,
    participants,
    groups,
    knockout,
    repechage,
    ranking,
    settings: {
      maxParticipants,
      format,
      codePrefix: getCodePrefixByType(type)
    }
  };
}

export async function createTournament(data) {
  const payload = buildTournamentPayload(data);
  await setDoc(doc(db, "tournaments", payload.code), payload);
  return payload;
}

export async function getTournamentByCode(codeInput) {
  const code = normalizeTournamentCode(codeInput);

  if (!isTournamentCodeValid(code)) {
    return { code, exists: false, error: "invalid_code" };
  }

  const snap = await getDoc(doc(db, "tournaments", code));
  if (!snap.exists()) {
    return { code, exists: false, error: "not_found" };
  }

  return { code, exists: true, data: snap.data() };
}

export async function updateTournamentData(codeInput, partialData) {
  const code = normalizeTournamentCode(codeInput);
  await updateDoc(doc(db, "tournaments", code), {
    ...partialData,
    updatedAt: serverTimestamp()
  });
}

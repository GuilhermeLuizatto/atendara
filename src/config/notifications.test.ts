import { describe, expect, it } from "vitest";

import { listAllProfessions } from "@/config/professions";
import { CONVERSATION_REPLY_EVENTS } from "@/types";

import { APPOINTMENT_EVENT_META, channelsForEvent } from "./notifications";

describe("respostas da assistente como eventos de aviso", () => {
  it("nascem desligadas, saem na hora e só pelo WhatsApp", () => {
    for (const event of CONVERSATION_REPLY_EVENTS) {
      const meta = APPOINTMENT_EVENT_META[event];
      expect(meta.defaultEnabled, event).toBe(false);
      expect(meta.anchor, event).toBe("CHANGE");
      expect(meta.allowedLeadMinutes, event).toEqual([0]);
      expect(meta.channels, event).toEqual(["WHATSAPP"]);
    }
  });

  it("a tela de avisos só oferece WhatsApp para elas, e os avisos da agenda mantêm os canais da profissão", () => {
    for (const profession of listAllProfessions()) {
      const { allowedChannels } = profession.notifications;
      for (const event of CONVERSATION_REPLY_EVENTS) {
        expect(channelsForEvent(event, allowedChannels), `${profession.id}/${event}`).toEqual(["WHATSAPP"]);
      }
      expect(channelsForEvent("APPOINTMENT_REMINDER", allowedChannels)).toEqual(allowedChannels);
    }
  });

  it("profissão que não permitisse WhatsApp não ganharia a resposta por outro canal", () => {
    expect(channelsForEvent("RESCHEDULE_OFFERED", ["EMAIL", "SMS"])).toEqual([]);
  });
});

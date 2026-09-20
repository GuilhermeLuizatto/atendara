// Gerado por scripts/build-functions.mjs.
import { whatsappTemplateFor } from "./whatsapp-config.js";
export function whatsappMessageFor(input) {
    if (input.channel !== "WHATSAPP")
        return null;
    const template = whatsappTemplateFor(input.event, input.disclosure);
    if (!template)
        return null;
    return {
        name: template.name,
        language: template.language,
        // O grau de exposição já escolheu o modelo, e o modelo já escolheu as
        // variáveis: nenhum valor além dos que aquele grau autoriza chega aqui.
        parameters: template.parameters.map((variable) => input.context[variable]),
        buttons: template.buttons,
    };
}

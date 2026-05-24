import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type ModalActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type PermissionsBitField as PermissionsBitFieldType,
  type UserSelectMenuInteraction
} from "discord.js";
import { EVENT_ALERTS_COMMAND } from "./commands";
import { formatOffset, OffsetParseError, parseAlertOffset } from "./offset";
import type { AlertRepository } from "./repository";
import type { Alert, SentAlert } from "./types";

const IDS = {
  addAlert: "eventAlerts:addAlert",
  clearHistory: "eventAlerts:clearHistory",
  confirmClearHistory: "eventAlerts:confirmClearHistory",
  history: "eventAlerts:history",
  back: "eventAlerts:back"
} as const;

const HISTORY_PAGE_SIZE = 5;
const MAX_ALERTS = 25;
const ALERTS_PER_CONTAINER = 4;

// Route Discord interactions into repository-backed alert configuration screens.
export async function handleInteraction(interaction: Interaction, repository: AlertRepository): Promise<void> {
  if (interaction.isChatInputCommand() && interaction.commandName === EVENT_ALERTS_COMMAND) {
    await handleCommand(interaction, repository);
    return;
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("eventAlerts:alertRecipients:")) {
    await handleAlertRecipientSelect(interaction, repository);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction, repository);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, repository);
  }
}

export function canConfigureAlerts(permissions: Readonly<PermissionsBitFieldType> | null | undefined): boolean {
  return Boolean(permissions?.has(PermissionsBitField.Flags.ManageEvents));
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  repository: AlertRepository
): Promise<void> {
  const guildId = await requireConfigurableGuild(interaction);
  if (!guildId) {
    return;
  }

  repository.ensureGuild(guildId);
  await interaction.reply(asEphemeralV2(buildMainPanel(repository, guildId, interaction.user.id)));
}

async function handleAlertRecipientSelect(
  interaction: UserSelectMenuInteraction,
  repository: AlertRepository
): Promise<void> {
  const guildId = await requireConfigurableGuild(interaction);
  if (!guildId) {
    return;
  }

  const alertId = interaction.customId.split(":")[2];
  const alert = repository.getAlert(alertId);
  if (!alert || alert.guildId !== guildId) {
    await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
    return;
  }

  const updatedAlert = repository.setAlertRecipients(alertId, interaction.values);
  await interaction.update(updatedAlert ? buildAlertPanel(updatedAlert) : buildMainPanel(repository, guildId, interaction.user.id));
}

async function handleButton(interaction: ButtonInteraction, repository: AlertRepository): Promise<void> {
  const guildId = await requireConfigurableGuild(interaction);
  if (!guildId) {
    return;
  }

  if (interaction.customId === IDS.addAlert) {
    if (repository.listAlerts(guildId).length >= MAX_ALERTS) {
      await interaction.reply({ content: `This server already has the maximum of ${MAX_ALERTS} alerts.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(buildOffsetModal("eventAlerts:modal:add", "Add alert"));
    return;
  }

  if (interaction.customId === IDS.back) {
    await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
    return;
  }

  if (interaction.customId.startsWith(`${IDS.history}:`)) {
    const page = Number(interaction.customId.split(":").at(-1) ?? "0");
    await interaction.update(buildHistoryPanel(repository, guildId, Number.isFinite(page) ? page : 0));
    return;
  }

  if (interaction.customId === IDS.clearHistory) {
    await interaction.update(buildClearHistoryConfirmationPanel(repository, guildId));
    return;
  }

  if (interaction.customId === IDS.confirmClearHistory) {
    repository.clearSentHistory(guildId);
    await interaction.update(buildHistoryPanel(repository, guildId, 0));
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:openAlert:")) {
    const alertId = interaction.customId.split(":")[2];
    const alert = repository.getAlert(alertId);
    if (!alert || alert.guildId !== guildId) {
      await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
      return;
    }

    await interaction.update(buildAlertPanel(alert));
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:subscribe:")) {
    const alertId = interaction.customId.split(":")[2];
    const alert = repository.getAlert(alertId);
    if (!alert || alert.guildId !== guildId) {
      await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
      return;
    }

    repository.setAlertRecipients(alert.id, [...alert.recipientIds, interaction.user.id]);
    await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:unsubscribe:")) {
    const alertId = interaction.customId.split(":")[2];
    const alert = repository.getAlert(alertId);
    if (!alert || alert.guildId !== guildId) {
      await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
      return;
    }

    repository.setAlertRecipients(
      alert.id,
      alert.recipientIds.filter((userId) => userId !== interaction.user.id)
    );
    await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:editAlert:")) {
    const alertId = interaction.customId.split(":")[2];
    const alert = repository.getAlert(alertId);
    if (!alert || alert.guildId !== guildId) {
      await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
      return;
    }

    await interaction.showModal(
      buildOffsetModal(`eventAlerts:modal:edit:${alert.id}`, "Edit alert timing", formatOffset(alert.amount, alert.unit))
    );
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:deleteAlert:")) {
    repository.deleteAlert(interaction.customId.split(":")[2]);
    await interaction.update(buildMainPanel(repository, guildId, interaction.user.id));
  }
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  repository: AlertRepository
): Promise<void> {
  const guildId = await requireConfigurableGuild(interaction);
  if (!guildId) {
    return;
  }

  let parsed: ReturnType<typeof parseAlertOffset>;
  try {
    parsed = parseAlertOffset(interaction.fields.getTextInputValue("offset"));
  } catch (error) {
    const message = error instanceof OffsetParseError ? error.message : "Invalid offset.";
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === "eventAlerts:modal:add") {
    const alert = repository.addAlert(guildId, parsed.amount, parsed.unit);
    await interaction.reply(asEphemeralV2(buildAlertPanel(alert)));
    return;
  }

  if (interaction.customId.startsWith("eventAlerts:modal:edit:")) {
    const alert = repository.updateAlert(interaction.customId.split(":")[3], parsed.amount, parsed.unit);
    await interaction.reply(
      asEphemeralV2(alert && alert.guildId === guildId ? buildAlertPanel(alert) : buildMainPanel(repository, guildId, interaction.user.id))
    );
  }
}

async function requireConfigurableGuild(
  interaction:
    | ChatInputCommandInteraction
    | UserSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
): Promise<string | null> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use this command in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }

  if (!canConfigureAlerts(interaction.memberPermissions)) {
    await interaction.reply({
      content: "You need the Manage Events permission to configure event alerts.",
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  return interaction.guildId;
}

function asEphemeralV2(panel: Pick<InteractionReplyOptions, "components">): InteractionReplyOptions {
  return {
    components: panel.components,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  };
}

export function buildMainPanel(
  repository: AlertRepository,
  guildId: string,
  currentUserId?: string
): InteractionReplyOptions & InteractionUpdateOptions {
  const alerts = repository.listAlerts(guildId);
  const headerContainer = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "# Event alerts",
          "Configure DM reminders for this server's scheduled events.",
          "",
          "**Alerts**"
        ].join("\n")
      )
    );
  const components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> = [headerContainer];

  if (alerts.length === 0) {
    headerContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent("No alerts configured."));
  } else {
    // Keep each container under Discord's v2 component limit while rendering per-alert controls.
    for (const alertGroup of chunkArray(alerts.slice(0, MAX_ALERTS), ALERTS_PER_CONTAINER)) {
      const alertContainer = new ContainerBuilder();
      for (const alert of alertGroup) {
        alertContainer.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(formatAlertSummary(alert, currentUserId)))
            .setButtonAccessory(
              new ButtonBuilder()
                .setCustomId(`eventAlerts:openAlert:${alert.id}`)
                .setLabel("Edit")
                .setStyle(ButtonStyle.Secondary)
          )
        );
        alertContainer.addActionRowComponents(buildSubscriptionRow(alert, currentUserId));
      }
      components.push(alertContainer);
    }
  }

  headerContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.addAlert)
      .setLabel("Add alert")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(alerts.length >= MAX_ALERTS),
    new ButtonBuilder().setCustomId(`${IDS.history}:0`).setLabel("Sent history").setStyle(ButtonStyle.Secondary)
  );

  components.push(buttonRow);
  return { components, flags: MessageFlags.IsComponentsV2 };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildSubscriptionRow(alert: Alert, currentUserId?: string): ActionRowBuilder<ButtonBuilder> {
  const isSubscribed = Boolean(currentUserId && alert.recipientIds.includes(currentUserId));
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`eventAlerts:subscribe:${alert.id}`)
      .setLabel("Subscribe")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isSubscribed || !currentUserId),
    new ButtonBuilder()
      .setCustomId(`eventAlerts:unsubscribe:${alert.id}`)
      .setLabel("Unsubscribe")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isSubscribed)
  );
}

export function buildAlertPanel(alert: Alert): InteractionUpdateOptions {
  const recipients =
    alert.recipientIds.length > 0 ? alert.recipientIds.map((userId) => `<@${userId}>`).join(", ") : "No recipients selected.";
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "# Alert",
        `${formatOffset(alert.amount, alert.unit)} before event start.`,
        "",
        `**Recipients**`,
        recipients
      ].join("\n")
    )
  );

  const recipientSelect = new UserSelectMenuBuilder()
    .setCustomId(`eventAlerts:alertRecipients:${alert.id}`)
    .setPlaceholder("Select recipients for this alert")
    .setMinValues(0)
    .setMaxValues(25);

  if (alert.recipientIds.length > 0) {
    recipientSelect.setDefaultUsers(alert.recipientIds.slice(0, 25));
  }

  const recipientRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(recipientSelect);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`eventAlerts:editAlert:${alert.id}`).setLabel("Edit timing").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`eventAlerts:deleteAlert:${alert.id}`).setLabel("Delete").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );

  return { components: [container, recipientRow, buttonRow], flags: MessageFlags.IsComponentsV2 };
}

function buildHistoryPanel(repository: AlertRepository, guildId: string, page: number): InteractionUpdateOptions {
  const normalizedPage = Math.max(0, page);
  const history = repository.listSentHistory(guildId, normalizedPage, HISTORY_PAGE_SIZE);
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ["# Sent history", history.length > 0 ? history.map(formatHistoryEntry).join("\n\n") : "No sent alerts yet."].join("\n")
    )
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.history}:${Math.max(0, normalizedPage - 1)}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(normalizedPage === 0),
    new ButtonBuilder()
      .setCustomId(`${IDS.history}:${normalizedPage + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(history.length < HISTORY_PAGE_SIZE),
    new ButtonBuilder().setCustomId(IDS.clearHistory).setLabel("Clear history").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

export function buildClearHistoryConfirmationPanel(repository: AlertRepository, guildId: string): InteractionUpdateOptions {
  const history = repository.listSentHistory(guildId, 0, 1);
  const detail =
    history.length > 0
      ? "This permanently deletes the sent-history records for this server. It does not delete alert configurations or recipients. Because Gregor uses sent history to avoid duplicate reminders, clearing it can cause notifications for already-sent event alerts to go out again."
      : "There is no sent history to clear for this server.";
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(["# Clear sent history?", detail].join("\n\n"))
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.confirmClearHistory)
      .setLabel("Clear sent history")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(history.length === 0),
    new ButtonBuilder().setCustomId(`${IDS.history}:0`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

function buildOffsetModal(customId: string, title: string, value?: string): ModalBuilder {
  const offsetInput = new TextInputBuilder()
    .setCustomId("offset")
    .setLabel("When should the alert send?")
    .setPlaceholder("30 minutes, 2 hours, or 1 day")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  if (value) {
    offsetInput.setValue(value);
  }

  // Discord modals only support text inputs, so timing is collected here.
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(offsetInput));
}

function formatAlertSummary(alert: Alert, currentUserId?: string): string {
  const recipientIds = prioritizeCurrentUser(alert.recipientIds, currentUserId);
  const recipientText = recipientIds.length > 0 ? recipientIds.map((userId) => `<@${userId}>`).join(", ") : "No recipients";
  return `**${formatOffset(alert.amount, alert.unit)} before**\n${recipientText}`;
}

function prioritizeCurrentUser(recipientIds: string[], currentUserId?: string): string[] {
  if (!currentUserId || !recipientIds.includes(currentUserId)) {
    return recipientIds;
  }

  return [currentUserId, ...recipientIds.filter((userId) => userId !== currentUserId)];
}

function formatHistoryEntry(entry: SentAlert): string {
  const start = Math.floor(new Date(entry.scheduledStartAt).getTime() / 1000);
  const sent = Math.floor(new Date(entry.sentAt).getTime() / 1000);
  const failed = entry.failedRecipients.length > 0 ? `, ${entry.failedRecipients.length} failed` : "";
  return [
    `**${entry.eventName}**`,
    `Event start: <t:${start}:F>`,
    `Alert: ${formatOffset(entry.offsetAmount, entry.offsetUnit)} before`,
    `Sent: <t:${sent}:R>`,
    `Recipients: ${entry.successfulRecipientIds.length}/${entry.attemptedRecipientIds.length} succeeded${failed}`
  ].join("\n");
}

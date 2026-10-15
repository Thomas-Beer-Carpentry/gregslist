import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import { db, siteUrl } from "../lib/client";
import {
  Body,
  Button,
  Card,
  Feedback,
  Field,
  Muted,
  Select,
  Title,
} from "../ui";

type Member = {
  user_id: string;
  display_name: string;
  bio: string;
  email: string;
  role: string;
  status: string;
  joined_at: string;
  status_changed_at: string | null;
};
type Invitation = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  delivery: string;
};
type AuditEntry = {
  id: string;
  action: string;
  actor_name: string | null;
  target_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const auditLabels: Record<string, string> = {
  invitation_created: "Invitation created",
  invitation_revoked: "Invitation revoked",
  invitation_redeemed: "Invitation accepted",
  invitation_sent: "Invitation email sent",
  member_suspended: "Member suspended",
  member_reactivated: "Member reactivated",
  member_removed: "Member removed",
  administrator_granted: "Administrator role granted",
  administrator_revoked: "Administrator role removed",
};

function date(value: string) {
  return new Date(value).toLocaleString();
}

function invitationStatus(invitation: Invitation) {
  if (invitation.redeemed_at) return "Accepted";
  if (invitation.revoked_at) return "Revoked";
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return "Expired";
  return "Pending";
}

function trustedWebUrl(path: string) {
  const url = new URL(path, siteUrl);
  if (url.protocol !== "https:" && !(__DEV__ && url.protocol === "http:"))
    throw new Error("A trusted HTTPS website must be configured.");
  return url;
}

export function AdministrationScreen({ userId }: { userId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState("email");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const requestVersion = useRef(0);

  const load = useCallback(
    async (query: string, allInvitations: boolean, invitationPage: number) => {
      const version = ++requestVersion.current;
      setBusy(true);
      try {
        let invitationQuery = db
          .from("invitations")
          .select(
            "id,email,created_at,expires_at,revoked_at,redeemed_at,delivery",
            { count: "exact" },
          );
        if (!allInvitations)
          invitationQuery = invitationQuery
            .is("revoked_at", null)
            .is("redeemed_at", null)
            .gt("expires_at", new Date().toISOString());
        const [memberResult, invitationResult, auditResult] = await Promise.all(
          [
            db.rpc("admin_members", {
              search_query: query.trim().slice(0, 80),
            }),
            invitationQuery
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(invitationPage * 50, invitationPage * 50 + 49),
            db
              .from("admin_audit")
              .select("id,action,actor_name,target_name,details,created_at")
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(50),
          ],
        );
        if (memberResult.error || invitationResult.error || auditResult.error)
          throw new Error("Administration is unavailable.");
        if (requestVersion.current !== version) return false;
        setMembers((memberResult.data || []) as Member[]);
        setInvitations((invitationResult.data || []) as Invitation[]);
        setAudit((auditResult.data || []) as AuditEntry[]);
        setAppliedSearch(query.trim().slice(0, 80));
        setHistory(allInvitations);
        setPage(invitationPage);
        setHasOlder((invitationResult.count || 0) > (invitationPage + 1) * 50);
        setLoaded(true);
        return true;
      } catch {
        if (requestVersion.current !== version) return false;
        // Clear previously authorised data if access has changed or refresh fails.
        setMembers([]);
        setInvitations([]);
        setAudit([]);
        setInvitationLink("");
        setLoaded(false);
        setMessage(
          "Administration could not be loaded. Check your connection and active administrator access, then refresh.",
        );
        return false;
      } finally {
        if (requestVersion.current === version) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    setMembers([]);
    setInvitations([]);
    setAudit([]);
    setInvitationLink("");
    setLoaded(false);
    void load("", false, 0);
    return () => {
      requestVersion.current += 1;
    };
  }, [load, userId]);

  async function refresh(
    query = appliedSearch,
    all = history,
    nextPage = page,
  ) {
    setMessage("");
    setInvitationLink("");
    await load(query, all, nextPage);
  }

  async function mutate(
    operation: string,
    parameters: Record<string, string>,
    success: string,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setInvitationLink("");
    try {
      const { error } = await db.rpc(operation, parameters);
      if (error) {
        await load(appliedSearch, history, page);
        setMessage(
          "The change was not applied. Check your administrator access, the member's current state and final-administrator protection. Refresh before trying again.",
        );
        return;
      }
      if (await load(appliedSearch, history, page)) setMessage(success);
    } catch {
      setMessage(
        "The result could not be confirmed. Refresh before trying again; the database retains the authoritative state.",
      );
    } finally {
      setBusy(false);
    }
  }

  function changeAccess(member: Member, status: string) {
    const verb =
      status === "active"
        ? "Reactivate"
        : status === "suspended"
          ? "Suspend"
          : "Remove";
    Alert.alert(
      `${verb} ${member.display_name}?`,
      status === "active"
        ? "This restores community access. Previous events, rides, reservations and partner links remain closed."
        : `${status === "removed" ? "Removal permanently ends community access and cannot be reactivated here." : "Suspension immediately pauses community access."} Active RSVPs, passenger bookings and partner links are closed, driving offers are withdrawn and upcoming events they organise are cancelled. Their account and history are retained.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: verb,
          style: status === "active" ? "default" : "destructive",
          onPress: () =>
            void mutate(
              "set_member_status",
              { target_user: member.user_id, new_status: status },
              status === "active"
                ? "Community access restored. Previous arrangements remain closed."
                : "Community access changed. Relevant arrangements were closed and history retained.",
            ),
        },
      ],
    );
  }

  function changeRole(member: Member) {
    const promote = member.role !== "admin";
    Alert.alert(
      promote
        ? `Make ${member.display_name} an administrator?`
        : `Remove ${member.display_name}'s administrator role?`,
      promote
        ? "Administrators can invite members, change community access and manage administrator roles."
        : "Ordinary member permissions remain. The final active administrator is protected. Permissions change on the next protected operation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm role change",
          onPress: () =>
            void mutate(
              "set_member_role",
              {
                target_user: member.user_id,
                new_role: promote ? "admin" : "member",
              },
              "Administrator role updated.",
            ),
        },
      ],
    );
  }

  async function createInvitation() {
    if (busy) return;
    const normalized = email.trim().toLowerCase();
    if (
      normalized.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ) {
      setMessage("Enter a valid email address for the intended recipient.");
      return;
    }
    setBusy(true);
    setMessage("");
    setInvitationLink("");
    try {
      if (delivery === "email") {
        const endpoint = trustedWebUrl("/api/mobile/invitations");
        const { data: sessionData } = await db.auth.getSession();
        if (!sessionData.session) {
          setMessage("Sign in again before sending an invitation.");
          return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        let response: Response;
        try {
          response = await fetch(endpoint.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionData.session.access_token}`,
            },
            body: JSON.stringify({ email: normalized }),
            redirect: "error",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (response.status !== 201) {
          await load(appliedSearch, history, page);
          setMessage(
            "The invitation email could not be sent. Check for an existing member or pending invitation, your administrator access and the server's email configuration. Refresh invitations before retrying.",
          );
          return;
        }
        setEmail("");
        if (await load(appliedSearch, history, page))
          setMessage(
            "Invitation email sent. The invitation expires after seven days; email verification links expire sooner.",
          );
        return;
      }
      const link = trustedWebUrl("/invite");
      const { data, error } = await db.rpc("create_member_invitation", {
        target_email: normalized,
        delivery: "copy",
      });
      if (
        error ||
        !data ||
        typeof data.id !== "string" ||
        typeof data.token !== "string"
      ) {
        setMessage(
          "Could not create an invitation. Check for an existing member or pending invitation, and your administrator access.",
        );
        return;
      }
      link.hash = new URLSearchParams({
        id: data.id,
        token: data.token,
      }).toString();
      if (await load(appliedSearch, history, page)) {
        setInvitationLink(link.toString());
        setEmail("");
        setMessage(
          "Invitation created. Copy it now and share privately with its intended recipient. It expires after seven days; the recipient must verify their email.",
        );
      } else {
        setMessage(
          "The invitation was created, but refreshed administrator access could not be confirmed, so its private link is hidden. Refresh and revoke that pending invitation before creating another.",
        );
      }
    } catch {
      setMessage(
        "The invitation result could not be confirmed. Refresh invitations before trying again, and check that the trusted website is configured.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!invitationLink) return;
    try {
      await Clipboard.setStringAsync(invitationLink);
      setMessage(
        "Invitation copied. Share it only with the intended recipient; your clipboard contains a private invitation link.",
      );
    } catch {
      setMessage(
        "Could not copy the invitation. You can select the link below.",
      );
    }
  }

  return (
    <>
      <Title>Community administration</Title>
      <Body>Welcome members, manage access and review important changes.</Body>
      <Feedback message={message} />
      <Button
        title={busy ? "Loading administration…" : "Refresh administration"}
        disabled={busy}
        secondary
        onPress={() => void refresh()}
      />
      <Card>
        <Title>Invite a member</Title>
        <Body>
          Invitations are single-use, bound to the intended email address and
          expire after seven days. Email verification remains required.
        </Body>
        <Field
          label="Their email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <Select
          label="Invitation delivery"
          value={delivery}
          onChange={setDelivery}
          options={[
            { value: "email", label: "Send a verification email" },
            { value: "copy", label: "Create a private copy link" },
          ]}
        />
        <Button
          title={
            delivery === "email"
              ? "Send invitation email"
              : "Create private invitation link"
          }
          onPress={() => void createInvitation()}
          disabled={busy || !loaded}
        />
        {invitationLink ? (
          <>
            <Text
              selectable
              accessibilityLabel="Private invitation link"
              style={{ color: "#1B1F23", fontSize: 14, lineHeight: 22 }}
            >
              {invitationLink}
            </Text>
            <Button
              title="Copy private invitation link"
              onPress={() => void copyInvitation()}
              disabled={busy}
            />
            <Button
              title="Hide invitation link"
              secondary
              onPress={() => setInvitationLink("")}
            />
            <Muted>
              This link is shown only here and will disappear when you leave or
              refresh. Revoke the invitation if it is shared incorrectly.
            </Muted>
          </>
        ) : null}
      </Card>
      {loaded ? (
        <>
          <Card>
            <Title>Invitations</Title>
            <Muted>
              {history ? "All invitation history" : "Pending invitations"} · 50
              per page
            </Muted>
            <Button
              title={history ? "Show pending invitations" : "Show all history"}
              secondary
              disabled={busy}
              onPress={() => void refresh(appliedSearch, !history, 0)}
            />
            {invitations.length === 0 ? (
              <Body>No invitations in this view.</Body>
            ) : null}
            {invitations.map((invitation) => (
              <Card key={invitation.id}>
                <Body>{invitation.email}</Body>
                <Body>{invitationStatus(invitation)}</Body>
                <Muted>
                  Created {date(invitation.created_at)} ·{" "}
                  {invitation.delivery === "copy" ? "Copy link" : "Email"}
                </Muted>
                <Muted>Expires {date(invitation.expires_at)}</Muted>
                {invitation.redeemed_at ? (
                  <Muted>Accepted {date(invitation.redeemed_at)}</Muted>
                ) : null}
                {invitation.revoked_at ? (
                  <Muted>Revoked {date(invitation.revoked_at)}</Muted>
                ) : null}
                {invitationStatus(invitation) === "Pending" ? (
                  <Button
                    title={`Revoke invitation for ${invitation.email}`}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(
                        "Revoke invitation?",
                        `${invitation.email} will no longer be able to accept this invitation.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Revoke",
                            style: "destructive",
                            onPress: () =>
                              void mutate(
                                "revoke_invitation",
                                { invitation_id: invitation.id },
                                "Invitation revoked.",
                              ),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
              </Card>
            ))}
            {page > 0 ? (
              <Button
                title="Newer invitations"
                secondary
                disabled={busy}
                onPress={() => void refresh(appliedSearch, history, page - 1)}
              />
            ) : null}
            {hasOlder ? (
              <Button
                title="Older invitations"
                secondary
                disabled={busy}
                onPress={() => void refresh(appliedSearch, history, page + 1)}
              />
            ) : null}
          </Card>
          <Card>
            <Title>Manage members</Title>
            <Muted>
              Member email addresses and these controls are available only to
              administrators. The community directory shows names and
              biographies.
            </Muted>
            <Field
              label="Search members by name or email"
              value={search}
              onChangeText={setSearch}
            />
            <Button
              title="Search members"
              secondary
              disabled={busy}
              onPress={() => void refresh(search, history, page)}
            />
            {appliedSearch ? (
              <Button
                title="Clear member search"
                secondary
                disabled={busy}
                onPress={() => {
                  setSearch("");
                  void refresh("", history, page);
                }}
              />
            ) : null}
            <Muted>
              {members.length} members shown. Searches return up to 100 members;
              narrow your search if needed.
            </Muted>
            {members.length === 0 ? <Body>No matching members.</Body> : null}
            {members.map((member) => {
              const removed =
                member.status === "removed" || member.status === "revoked";
              const self = member.user_id === userId;
              return (
                <Card key={member.user_id}>
                  <Title>
                    {member.display_name}
                    {self ? " · You" : ""}
                  </Title>
                  <Body>{member.email}</Body>
                  <Body>
                    {removed
                      ? "Removed"
                      : member.status === "suspended"
                        ? "Suspended"
                        : "Active"}
                    {" · "}
                    {member.role === "admin" ? "Administrator" : "Member"}
                  </Body>
                  {member.bio ? <Body>{member.bio}</Body> : null}
                  <Muted>Joined {date(member.joined_at)}</Muted>
                  {member.status_changed_at ? (
                    <Muted>
                      Access changed {date(member.status_changed_at)}
                    </Muted>
                  ) : null}
                  {removed ? (
                    <Muted>
                      Access has ended. The account and history are retained;
                      removal cannot be reactivated here.
                    </Muted>
                  ) : (
                    <>
                      {!self ? (
                        <>
                          <Button
                            title={
                              member.status === "suspended"
                                ? `Reactivate ${member.display_name}`
                                : `Suspend ${member.display_name}`
                            }
                            secondary
                            disabled={busy}
                            onPress={() =>
                              changeAccess(
                                member,
                                member.status === "suspended"
                                  ? "active"
                                  : "suspended",
                              )
                            }
                          />
                          <Button
                            title={`Remove ${member.display_name}`}
                            secondary
                            disabled={busy}
                            onPress={() => changeAccess(member, "removed")}
                          />
                        </>
                      ) : (
                        <Muted>
                          Ask another administrator to change your own community
                          access.
                        </Muted>
                      )}
                      {member.status === "active" || member.role === "admin" ? (
                        <Button
                          title={
                            member.role === "admin"
                              ? `Remove administrator role from ${member.display_name}`
                              : `Make ${member.display_name} an administrator`
                          }
                          secondary
                          disabled={busy}
                          onPress={() => changeRole(member)}
                        />
                      ) : null}
                    </>
                  )}
                </Card>
              );
            })}
          </Card>
          <Card>
            <Title>Administrative history</Title>
            <Muted>The latest 50 actions. History cannot be edited here.</Muted>
            {audit.length === 0 ? <Body>No actions recorded yet.</Body> : null}
            {audit.map((entry) => (
              <Card key={entry.id}>
                <Body>
                  {auditLabels[entry.action] || "Administration updated"}
                </Body>
                <Body>
                  {entry.actor_name || "Administrator"}
                  {entry.target_name
                    ? ` · ${entry.target_name}`
                    : typeof entry.details.email === "string"
                      ? ` · ${entry.details.email}`
                      : ""}
                </Body>
                <Muted>{date(entry.created_at)}</Muted>
              </Card>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

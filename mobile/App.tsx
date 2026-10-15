import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { User } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import { configured, db, apiFetch, siteUrl } from "./lib/client";
import { friendlyError, trustedWebUrl } from "./lib/security";
import {
  eventInstant,
  localEventTime,
  positiveCapacity,
  postTypes,
} from "./lib/content";
import { AdministrationScreen } from "./features/Administration";
import { PartnerScreen, TransportSection } from "./features/Transport";
import {
  Body,
  Button,
  Card,
  Feedback,
  Field,
  Loading,
  Muted,
  palette,
  Select,
  Title,
} from "./ui";

type Membership = { role: string; status: string };
type Post = {
  id: string;
  author_id: string;
  category_id: string;
  post_type: string;
  title: string;
  description: string;
  status: string;
  ride_coordination_enabled: boolean;
  created_at: string;
  availability: string;
  conditions: string;
  location: string;
};
type Event = {
  post_id: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string;
  status: string;
  capacity: number | null;
};
type Category = { id: string; name: string; active: boolean };
type Route = { page: string; post?: string; mode?: string };
const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
function openWeb(path: string) {
  void Linking.openURL(trustedWebUrl(siteUrl, path));
}

export default function App() {
  const checkVersion = useRef(0);
  const foreground = useRef(AppState.currentState === "active");
  const [privacyCovered, setPrivacyCovered] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const check = useCallback(async () => {
    const version = ++checkVersion.current;
    if (!configured) {
      setReady(true);
      return;
    }
    setChecking(true);
    try {
      const result = await db.auth.getUser();
      if (version !== checkVersion.current) return;
      if (result.error || !result.data.user) {
        setUser(null);
        setMembership(null);
        return;
      }
      const current = result.data.user;
      const member = await db
        .from("memberships")
        .select("role,status")
        .eq("user_id", current.id)
        .maybeSingle();
      if (version !== checkVersion.current) return;
      if (member.error) throw member.error;
      setUser(current);
      setMembership(member.data);
      setMessage("");
    } catch {
      if (version !== checkVersion.current) return;
      // Fail closed; do not keep a private screen visible while authority cannot
      // be checked. Device secure storage retains only the authentication session.
      setMembership(null);
      setMessage(
        "Could not verify community access. Check your connection and retry.",
      );
    } finally {
      if (version === checkVersion.current) {
        setChecking(false);
        setReady(true);
        if (foreground.current) setPrivacyCovered(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    void check();
    const subscription = db.auth.onAuthStateChange(() => {
      setTimeout(() => void check(), 0);
    });
    const appState = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      setPrivacyCovered(true);
      if (state === "active") {
        db.auth.startAutoRefresh();
        void check();
      } else db.auth.stopAutoRefresh();
    });
    const blur = AppState.addEventListener("blur", () => {
      foreground.current = false;
      setPrivacyCovered(true);
      db.auth.stopAutoRefresh();
    });
    const focus = AppState.addEventListener("focus", () => {
      if (AppState.currentState !== "active") return;
      foreground.current = true;
      setPrivacyCovered(true);
      db.auth.startAutoRefresh();
      void check();
    });
    if (AppState.currentState === "active") db.auth.startAutoRefresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void check();
    }, 30000);
    return () => {
      clearInterval(timer);
      subscription.data.subscription.unsubscribe();
      appState.remove();
      blur.remove();
      focus.remove();
      db.auth.stopAutoRefresh();
    };
  }, [check]);
  async function signOut() {
    checkVersion.current++;
    setMembership(null);
    setUser(null);
    await db.auth.signOut({ scope: "local" });
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <View
          style={{ flex: 1, opacity: configured && privacyCovered ? 0 : 1 }}
          pointerEvents={configured && privacyCovered ? "none" : "auto"}
          accessibilityElementsHidden={configured && privacyCovered}
          importantForAccessibility={
            configured && privacyCovered ? "no-hide-descendants" : "auto"
          }
        >
          {!configured ? (
            <ScrollView contentContainerStyle={{ padding: 24 }}>
              <Title>Gregslist</Title>
              <Card>
                <Body>
                  The iPhone and Android app needs this community’s secure
                  server connection before it can be used.
                </Body>
                <Muted>
                  The publisher must supply the real HTTPS website, Supabase
                  project and public key at build time. No private content is
                  bundled with this app.
                </Muted>
              </Card>
            </ScrollView>
          ) : !ready ? (
            <Loading />
          ) : !user ? (
            <AuthScreen onSignedIn={check} />
          ) : membership?.status === "active" ? (
            <MemberApp
              key={user.id}
              user={user}
              membership={membership}
              checkAccess={check}
              signOut={signOut}
            />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
              <Title>Community access</Title>
              <Feedback message={message} />
              <Body>
                {membership?.status === "suspended"
                  ? "Your access is suspended. Contact a community administrator."
                  : membership?.status === "removed" ||
                      membership?.status === "revoked"
                    ? "Your community access has been removed."
                    : "An accepted administrator invitation is required."}
              </Body>
              <Button
                title="Check access again"
                disabled={checking}
                onPress={() => void check()}
              />
              <Button
                title="Invitation help"
                secondary
                onPress={() => openWeb("/invite")}
              />
              <Deletion user={user} onDeleted={signOut} />
              <Button
                title="Sign out"
                secondary
                onPress={() => void signOut()}
              />
            </ScrollView>
          )}
        </View>
        {configured && privacyCovered ? (
          <View
            accessibilityViewIsModal
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: palette.background,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              gap: 16,
            }}
          >
            <Title>Gregslist</Title>
            <Body>Checking community access…</Body>
            <Loading />
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AuthScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function login() {
    setBusy(true);
    setMessage("");
    try {
      const result = await db.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error)
        setMessage(
          "Unable to sign in. Check your details or recover your password.",
        );
      else {
        setPassword("");
        await onSignedIn();
      }
    } catch {
      setMessage("Sign-in is unavailable. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 24, gap: 16 }}
    >
      <Title>Gregslist</Title>
      <Body>A little closer together.</Body>
      <Card>
        <Title>Welcome back.</Title>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          maxLength={254}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={128}
        />
        <Feedback message={message} />
        <Button
          title={busy ? "Signing in…" : "Sign in"}
          disabled={busy || !email || !password}
          onPress={() => void login()}
        />
        <Button
          title="Recover password"
          secondary
          onPress={() => openWeb("/recover")}
        />
        <Button
          title="Open invitation help"
          secondary
          onPress={() => openWeb("/invite")}
        />
        <Muted>
          Membership is by administrator invitation. Email verification and
          first password setup open on the community’s secure website; then
          return here to sign in.
        </Muted>
      </Card>
    </ScrollView>
  );
}

function MemberApp({
  user,
  membership,
  checkAccess,
  signOut,
}: {
  user: User;
  membership: Membership;
  checkAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}) {
  const [route, setRoute] = useState<Route>({ page: "feed" });
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const go = (next: Route) => setRoute(next);
  function back() {
    if (route.page === "compose")
      Alert.alert("Discard this draft?", "Unsaved changes will be lost.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => go({ page: "feed" }),
        },
      ]);
    else go({ page: "feed" });
  }
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.page === "feed") return false;
      back();
      return true;
    });
    return () => listener.remove();
  });
  async function reload() {
    setRefreshing(true);
    await checkAccess();
    setRefresh((value) => value + 1);
    setRefreshing(false);
  }
  const navigation = [
    "feed",
    "events",
    "saved",
    "new post",
    "partners",
    "members",
    "updates",
    "settings",
    ...(membership.role === "admin" ? ["administration"] : []),
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, backgroundColor: palette.forest }}>
        <Text
          accessibilityRole="header"
          style={{ color: palette.white, fontSize: 26, fontWeight: "700" }}
        >
          Gregslist
        </Text>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, padding: 12 }}
        accessibilityLabel="Main navigation"
      >
        {navigation.map((page) => (
          <Button
            key={page}
            title={label(page)}
            secondary={route.page !== page}
            onPress={() => {
              if (route.page === "compose") {
                Alert.alert(
                  "Leave this draft?",
                  "Unsaved changes will be lost.",
                  [
                    { text: "Keep editing", style: "cancel" },
                    {
                      text: "Leave",
                      style: "destructive",
                      onPress: () =>
                        go({ page: page === "new post" ? "compose" : page }),
                    },
                  ],
                );
              } else go({ page: page === "new post" ? "compose" : page });
            }}
          />
        ))}
      </ScrollView>
      <ScrollView
        key={`${route.page}:${route.post || ""}:${refresh}`}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={palette.forest}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      >
        {["detail", "compose"].includes(route.page) && (
          <Button title="Back to noticeboard" secondary onPress={back} />
        )}
        {["feed", "events", "saved"].includes(route.page) && (
          <Feed
            mode={route.page}
            open={(id) => go({ page: "detail", post: id })}
          />
        )}
        {route.page === "detail" && route.post && (
          <Detail
            id={route.post}
            userId={user.id}
            isAdmin={membership.role === "admin"}
            edit={() => go({ page: "compose", post: route.post })}
            changed={() => setRefresh((v) => v + 1)}
            removed={() => go({ page: "feed" })}
          />
        )}
        {route.page === "compose" && (
          <Compose
            id={route.post}
            saved={(id) => go({ page: "detail", post: id })}
          />
        )}
        {route.page === "partners" && <PartnerScreen userId={user.id} />}
        {route.page === "members" && <Directory />}
        {route.page === "updates" && (
          <Updates
            open={(id) => go({ page: "detail", post: id })}
            partners={() => go({ page: "partners" })}
          />
        )}
        {route.page === "settings" && (
          <Settings user={user} signOut={signOut} />
        )}
        {route.page === "administration" && membership.role === "admin" && (
          <AdministrationScreen userId={user.id} />
        )}
      </ScrollView>
    </View>
  );
}

function UpcomingEvents({ open }: { open: (id: string) => void }) {
  const [events, setEvents] = useState<
    {
      post_id: string;
      starts_at: string;
      timezone: string;
      posts: { title: string };
    }[]
  >([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    void db
      .from("events")
      .select("post_id,starts_at,timezone,posts!inner(title,status)")
      .eq("status", "scheduled")
      .eq("posts.status", "open")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5)
      .then((result) => {
        if (!mounted) return;
        if (result.error) setMessage("Upcoming events could not be loaded.");
        else setEvents((result.data || []) as unknown as typeof events);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <Card>
      <Title>Upcoming events</Title>
      <Feedback message={message} />
      {events.map((event) => (
        <View key={event.post_id} style={{ gap: 8 }}>
          <Muted>
            {new Date(event.starts_at).toLocaleString(undefined, {
              timeZone: event.timezone,
            })}{" "}
            · {event.timezone}
          </Muted>
          <Button
            title={event.posts.title}
            secondary
            onPress={() => open(event.post_id)}
          />
        </View>
      ))}
      {!events.length && !message && <Muted>No upcoming plans yet.</Muted>}
    </Card>
  );
}

function Feed({ mode, open }: { mode: string; open: (id: string) => void }) {
  const applied = useRef({ query: "", category: "", kind: "", status: "" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load(older = false) {
    setBusy(true);
    setMessage("");
    try {
      const filters = older
        ? applied.current
        : { query, category, kind, status };
      if (!older) applied.current = filters;
      const previous = older ? posts.at(-1) : null;
      const results = await Promise.all([
        db.from("categories").select("id,name,active").order("name"),
        db.rpc("noticeboard_feed", {
          search_text: filters.query.trim(),
          category_filter: filters.category || null,
          type_filter: mode === "events" ? "event" : filters.kind || null,
          status_filter: filters.status || null,
          saved_only: mode === "saved",
          before_time: previous?.created_at || null,
          before_id: previous?.id || null,
          page_size: 21,
        }),
      ]);
      if (results.some((result) => result.error)) throw new Error();
      setCategories(results[0].data || []);
      const rows = (results[1].data || []) as Post[];
      setMore(rows.length > 20);
      setPosts(older ? [...posts, ...rows.slice(0, 20)] : rows.slice(0, 20));
    } catch {
      setPosts([]);
      setMessage(
        "The noticeboard could not be loaded. Check access and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [mode]);
  return (
    <>
      {mode !== "saved" && <UpcomingEvents open={open} />}
      <Title>
        {mode === "events"
          ? "Community events"
          : mode === "saved"
            ? "Saved posts"
            : "A little closer together."}
      </Title>
      <Card>
        <Field
          label="Search posts"
          value={query}
          onChangeText={setQuery}
          maxLength={160}
        />
        <Select
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { label: "All categories", value: "" },
            ...categories
              .filter((item) => item.active)
              .map((item) => ({ label: item.name, value: item.id })),
          ]}
        />
        {mode !== "events" && (
          <Select
            label="Post type"
            value={kind}
            onChange={setKind}
            options={[
              { label: "All types", value: "" },
              ...postTypes.map((value) => ({ label: label(value), value })),
            ]}
          />
        )}
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { label: "All statuses", value: "" },
            ...["open", "fulfilled", "cancelled", "completed", "archived"].map(
              (value) => ({ label: label(value), value }),
            ),
          ]}
        />
        <Button
          title="Apply filters"
          disabled={busy}
          onPress={() => void load()}
        />
      </Card>
      <Feedback message={message} />
      {busy && <Loading />}
      {posts.map((post) => (
        <Card key={post.id}>
          <Muted>
            {label(post.post_type)} · {label(post.status)}
          </Muted>
          <Title>{post.title}</Title>
          <Body>
            {post.description.length > 250
              ? `${post.description.slice(0, 250)}…`
              : post.description}
          </Body>
          <Button
            title={`Open ${post.title}`}
            secondary
            onPress={() => open(post.id)}
          />
        </Card>
      ))}
      {!busy && !posts.length && !message && (
        <Card>
          <Title>No matching posts.</Title>
          <Body>
            Try another filter or share something with your community.
          </Body>
        </Card>
      )}
      {more && (
        <Button
          title="Older posts"
          disabled={busy}
          secondary
          onPress={() => void load(true)}
        />
      )}
    </>
  );
}

function Detail({
  id,
  userId,
  isAdmin,
  edit,
  changed,
  removed,
}: {
  id: string;
  userId: string;
  isAdmin: boolean;
  edit: () => void;
  changed: () => void;
  removed: () => void;
}) {
  const [post, setPost] = useState<Post | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [comments, setComments] = useState<
    { id: string; author_id: string; body: string }[]
  >([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<{ id: string }[]>([]);
  const [attendance, setAttendance] = useState<
    { display_name: string; response: string }[]
  >([]);
  const [comment, setComment] = useState("");
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [hasRideHistory, setHasRideHistory] = useState(false);
  async function load() {
    const results = await Promise.all([
      db.from("posts").select("*").eq("id", id).maybeSingle(),
      db.from("events").select("*").eq("post_id", id).maybeSingle(),
      db
        .from("comments")
        .select("id,author_id,body")
        .eq("post_id", id)
        .order("created_at"),
      db.from("post_photos").select("id").eq("post_id", id).order("position"),
      db
        .from("saved_posts")
        .select("post_id")
        .eq("user_id", userId)
        .eq("post_id", id),
      db.from("profiles").select("id,display_name"),
    ]);
    if (results.some((result) => result.error) || !results[0].data) {
      setPost(null);
      setMessage(
        "This post could not be loaded. It may have been removed or your access changed.",
      );
      return;
    }
    setPost(results[0].data);
    if (!results[0].data.ride_coordination_enabled) {
      const history = await db
        .from("ride_offers")
        .select("id")
        .eq("post_id", id)
        .limit(1);
      setHasRideHistory(Boolean(history.data?.length));
      if (history.error)
        setMessage(
          "Transport history could not be loaded. Pull to refresh and retry.",
        );
    }
    setEvent(results[1].data);
    setComments(results[2].data || []);
    setPhotos(results[3].data || []);
    setSaved(Boolean(results[4].data?.length));
    setNames(
      Object.fromEntries(
        (results[5].data || []).map((person) => [
          person.id,
          person.display_name,
        ]),
      ),
    );
    setToken((await db.auth.getSession()).data.session?.access_token || "");
    if (results[1].data) {
      const result = await db.rpc("event_attendance", { target_event: id });
      if (!result.error) setAttendance(result.data || []);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function act(
    name: string,
    parameters: Record<string, unknown>,
    confirmation = "Saved.",
  ) {
    setBusy(true);
    setMessage("");
    try {
      const result = await db.rpc(name, parameters);
      if (result.error) setMessage(friendlyError(result.error.message));
      else {
        await load();
        setMessage(confirmation);
      }
    } catch {
      setMessage("The result could not be confirmed. Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    setBusy(true);
    setMessage("");
    let temporaryPhotoUri: string | undefined;
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage("Allow photo-library access to choose a post photo.");
        return;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        exif: false,
        quality: 0.85,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      const converted = await ImageManipulator.manipulateAsync(
        asset.uri,
        asset.width > 1920 ? [{ resize: { width: 1920 } }] : [],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      temporaryPhotoUri = converted.uri;
      const body = new FormData();
      body.append("photo", {
        uri: converted.uri,
        type: "image/jpeg",
        name: "community-photo.jpg",
      } as unknown as Blob);
      const response = await apiFetch(`/api/posts/${id}/photos`, {
        method: "POST",
        body,
      });
      if (!response.ok)
        setMessage(
          "Photo could not be uploaded. Check the six-photo limit, your access and connection.",
        );
      else {
        await load();
        setMessage("Photo added.");
      }
    } catch {
      setMessage(
        "Photo upload was interrupted. Your post is still saved; retry the photo separately.",
      );
    } finally {
      if (temporaryPhotoUri) {
        try {
          const temporaryPhoto = new File(temporaryPhotoUri);
          if (temporaryPhoto.exists) temporaryPhoto.delete();
        } catch {
          setMessage((previous) =>
            `${previous} The photo's temporary copy could not be removed from this device.`.trim(),
          );
        }
      }
      setBusy(false);
    }
  }
  if (!post)
    return (
      <>
        <Feedback message={message} />
        <Button title="Retry loading post" onPress={() => void load()} />
      </>
    );
  const owner = post.author_id === userId;
  return (
    <>
      <Card>
        <Muted>
          {label(post.post_type)} · {label(post.status)} ·{" "}
          {names[post.author_id] || "Community member"}
        </Muted>
        <Title>{post.title}</Title>
        <Body>{post.description}</Body>
        {post.location && <Body>Location: {post.location}</Body>}
        {post.availability && <Body>Availability: {post.availability}</Body>}
        {post.conditions && <Body>Conditions: {post.conditions}</Body>}
        <Feedback message={message} />
        <Button
          title={saved ? "Unsave post" : "Save post"}
          disabled={busy}
          secondary
          onPress={() =>
            void act(
              "set_saved_post",
              { target_id: id, should_save: !saved },
              saved ? "Post unsaved." : "Post saved.",
            )
          }
        />
        {owner && <Button title="Edit post" secondary onPress={edit} />}
        {(owner || isAdmin) && (
          <Button
            title="Delete post"
            secondary
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "Delete this post?",
                "Posts with event or ride history must be closed instead.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      setBusy(true);
                      void db
                        .rpc("delete_post", { target_id: id })
                        .then((result) => {
                          setBusy(false);
                          if (result.error)
                            setMessage(
                              "This post cannot be deleted. Close its event or ride arrangements instead.",
                            );
                          else removed();
                        });
                    },
                  },
                ],
              )
            }
          />
        )}
      </Card>
      {event && (
        <Card>
          <Title>Event details</Title>
          <Body>
            {new Date(event.starts_at).toLocaleString(undefined, {
              timeZone: event.timezone,
            })}{" "}
            · {event.timezone}
          </Body>
          {event.ends_at && (
            <Body>
              Ends{" "}
              {new Date(event.ends_at).toLocaleString(undefined, {
                timeZone: event.timezone,
              })}
            </Body>
          )}
          <Body>
            {event.location} · {label(event.status)}
          </Body>
          <Body>
            {event.capacity === null
              ? "Unlimited attendance"
              : `Capacity ${event.capacity}`}
          </Body>
          <Title>RSVP</Title>
          {["going", "maybe", "not_going"].map((response) => (
            <Button
              key={response}
              title={label(response)}
              secondary
              disabled={
                busy ||
                event.status !== "scheduled" ||
                (response !== "not_going" &&
                  Date.parse(event.starts_at) <= Date.now())
              }
              onPress={() =>
                void act(
                  "set_event_rsvp",
                  { target_event: id, chosen_response: response },
                  "Your RSVP was saved.",
                )
              }
            />
          ))}
          <Title>Attendees</Title>
          {attendance.length ? (
            attendance.map((person, index) => (
              <Body key={index}>
                {person.display_name} · {label(person.response)}
              </Body>
            ))
          ) : (
            <Muted>No active responses yet.</Muted>
          )}
        </Card>
      )}
      {(post.ride_coordination_enabled || hasRideHistory) && (
        <TransportSection
          post={post}
          userId={userId}
          isAdmin={isAdmin}
          onChanged={changed}
        />
      )}
      <Card>
        <Title>Photos</Title>
        {photos.map((photo) => (
          <View key={photo.id} style={{ gap: 10 }}>
            <Image
              accessibilityLabel="Private community post photo"
              source={{
                uri: `${siteUrl}/photos/${photo.id}`,
                headers: { Authorization: `Bearer ${token}` },
                cache: "reload",
              }}
              style={{ width: "100%", height: 220, borderRadius: 8 }}
              resizeMode="contain"
            />
            {owner && (
              <Button
                title="Remove photo"
                secondary
                disabled={busy}
                onPress={() =>
                  void act(
                    "remove_post_photo",
                    { target_id: photo.id },
                    "Photo removed.",
                  )
                }
              />
            )}
          </View>
        ))}
        {!photos.length && <Muted>No photos shared.</Muted>}
        {owner && (
          <Button
            title="Add photo"
            disabled={busy || photos.length >= 6}
            onPress={() => void upload()}
          />
        )}
        <Muted>
          Up to six private photos. The server validates and strips embedded
          metadata.
        </Muted>
      </Card>
      <Card>
        <Title>Discussion</Title>
        {comments.map((item) => (
          <View key={item.id} style={{ paddingVertical: 12, gap: 8 }}>
            <Muted>{names[item.author_id] || "Community member"}</Muted>
            <Body>{item.body}</Body>
            {item.author_id === userId && (
              <Button
                title="Edit comment"
                secondary
                onPress={() => {
                  setEditingComment(item.id);
                  setComment(item.body);
                }}
              />
            )}
            {(item.author_id === userId || isAdmin) && (
              <Button
                title="Delete comment"
                secondary
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Delete this comment?",
                    "This cannot be undone.",
                    [
                      { text: "Keep", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () =>
                          void act(
                            "delete_comment",
                            { target_id: item.id },
                            "Comment deleted.",
                          ),
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        ))}
        {!["cancelled", "archived"].includes(post.status) && (
          <>
            <Field
              label={editingComment ? "Edit your comment" : "Add a comment"}
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={10000}
            />
            <Button
              title={editingComment ? "Save comment" : "Post comment"}
              disabled={busy || !comment.trim()}
              onPress={() => {
                setBusy(true);
                void db
                  .rpc("write_comment", {
                    target_post: id,
                    comment_id: editingComment,
                    comment_body: comment.trim(),
                  })
                  .then(async (result) => {
                    if (result.error)
                      setMessage(
                        "Comment could not be saved. Your text is still here.",
                      );
                    else {
                      setComment("");
                      setEditingComment(null);
                      await load();
                    }
                    setBusy(false);
                  });
              }}
            />
            {editingComment && (
              <Button
                title="Cancel editing"
                secondary
                onPress={() => {
                  setEditingComment(null);
                  setComment("");
                }}
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}

function Compose({ id, saved }: { id?: string; saved: (id: string) => void }) {
  const [original, setOriginal] = useState<Post | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState("discussion");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("open");
  const [rides, setRides] = useState("false");
  const [location, setLocation] = useState("");
  const [availability, setAvailability] = useState("");
  const [conditions, setConditions] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [zone, setZone] = useState("Pacific/Auckland");
  const [capacity, setCapacity] = useState("");
  const [confirm, setConfirm] = useState("false");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void (async () => {
      const cat = await db
        .from("categories")
        .select("id,name,active")
        .order("name");
      if (cat.error) {
        setMessage("Categories could not be loaded.");
        return;
      }
      setCategories(cat.data || []);
      setCategory(cat.data?.find((item) => item.active)?.id || "");
      if (id) {
        const [post, event] = await Promise.all([
          db.from("posts").select("*").eq("id", id).single(),
          db.from("events").select("*").eq("post_id", id).maybeSingle(),
        ]);
        if (post.error || event.error) {
          setMessage(
            "This draft could not be loaded. Refresh and check ownership.",
          );
          return;
        }
        const item = post.data as Post;
        setOriginal(item);
        setKind(item.post_type);
        setCategory(item.category_id);
        setTitle(item.title);
        setDescription(item.description);
        setStatus(item.status);
        setRides(String(item.ride_coordination_enabled));
        setAvailability(item.availability);
        setConditions(item.conditions);
        setLocation(event.data?.location || item.location);
        if (event.data) {
          setZone(event.data.timezone);
          setStarts(localEventTime(event.data.starts_at, event.data.timezone));
          setEnds(localEventTime(event.data.ends_at, event.data.timezone));
          setCapacity(
            event.data.capacity === null ? "" : String(event.data.capacity),
          );
        }
      }
      setReady(true);
    })();
  }, [id]);
  async function submit() {
    setMessage("");
    if (!title.trim() || !description.trim() || !category) {
      setMessage("Add a title, description and category.");
      return;
    }
    let content;
    try {
      const start = kind === "event" ? eventInstant(starts, zone) : null;
      const end = kind === "event" ? eventInstant(ends, zone) : null;
      if (
        kind === "event" &&
        (!start ||
          !location.trim() ||
          (end && Date.parse(end) <= Date.parse(start)))
      )
        throw new Error("Check the event dates and location.");
      content = {
        title: title.trim(),
        description: description.trim(),
        post_type: kind,
        category_id: category,
        status,
        ride_coordination_enabled: rides === "true",
        location: kind === "event" ? "" : location,
        availability,
        conditions,
        ...(kind === "event"
          ? {
              starts_at: start,
              ends_at: end,
              timezone: zone,
              event_location: location.trim(),
              capacity: positiveCapacity(capacity),
            }
          : {}),
        confirm_cancel: confirm === "true",
        confirm_transport_close: confirm === "true",
      };
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Check event dates and timezone.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await db.rpc("write_post", {
        target_id: id || null,
        content,
      });
      if (result.error) setMessage(friendlyError(result.error.message));
      else saved(result.data);
    } catch {
      setMessage(
        "The save result is unknown. Check the noticeboard before creating another post. Your draft remains here.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <>
        <Feedback message={message} />
        <Loading />
      </>
    );
  return (
    <Card>
      <Title>{original ? "Edit your post" : "Share with your community"}</Title>
      {!original ? (
        <Select
          label="Post type"
          value={kind}
          onChange={setKind}
          options={postTypes.map((value) => ({ label: label(value), value }))}
        />
      ) : (
        <Muted>Post type: {label(kind)}</Muted>
      )}
      <Select
        label="Category"
        value={category}
        onChange={setCategory}
        options={categories
          .filter((item) => item.active || item.id === category)
          .map((item) => ({ label: item.name, value: item.id }))}
      />
      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        maxLength={160}
      />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={20000}
      />
      <Select
        label="Status"
        value={status}
        onChange={setStatus}
        options={(kind === "event"
          ? ["open", "cancelled", "completed", "archived"]
          : ["open", "fulfilled", "cancelled", "archived"]
        ).map((value) => ({ label: label(value), value }))}
      />
      <Select
        label="People might need a ride for this"
        value={rides}
        onChange={setRides}
        options={[
          { label: "No ride coordination", value: "false" },
          { label: "Enable ride coordination", value: "true" },
        ]}
      />
      <Field
        label={
          kind === "event" ? "Event location" : "Location or pickup (optional)"
        }
        value={location}
        onChangeText={setLocation}
        maxLength={300}
      />
      {kind === "event" ? (
        <>
          <Field
            label="Starts (YYYY-MM-DDTHH:mm)"
            value={starts}
            onChangeText={setStarts}
            autoCapitalize="none"
          />
          <Field
            label="Ends (optional, YYYY-MM-DDTHH:mm)"
            value={ends}
            onChangeText={setEnds}
            autoCapitalize="none"
          />
          <Field
            label="Timezone"
            value={zone}
            onChangeText={setZone}
            autoCapitalize="none"
          />
          <Field
            label="Attendance capacity (blank for unlimited)"
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="number-pad"
          />
          <Muted>
            Dates use the named timezone. Ambiguous or nonexistent
            daylight-saving times are rejected.
          </Muted>
        </>
      ) : (
        <>
          <Field
            label="Availability (optional)"
            value={availability}
            onChangeText={setAvailability}
            maxLength={300}
          />
          <Field
            label="Conditions (optional)"
            value={conditions}
            onChangeText={setConditions}
            multiline
            maxLength={1000}
          />
        </>
      )}
      {original && (
        <>
          <Muted>
            Closing/cancelling can end attendance and ride bookings. Reopening
            never restores old arrangements.
          </Muted>
          <Select
            label="Confirm closing affected attendance and rides"
            value={confirm}
            onChange={setConfirm}
            options={[
              { label: "I have not confirmed", value: "false" },
              { label: "I understand and confirm", value: "true" },
            ]}
          />
        </>
      )}
      <Feedback message={message} />
      <Button
        title={busy ? "Saving…" : original ? "Save changes" : "Publish post"}
        disabled={busy}
        onPress={() => void submit()}
      />
    </Card>
  );
}

function Directory() {
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<{ display_name: string; bio: string }[]>(
    [],
  );
  const [message, setMessage] = useState("");
  async function load() {
    const result = await db.rpc("member_directory", {
      search_query: search.trim(),
    });
    if (result.error) {
      setPeople([]);
      setMessage("The directory could not be loaded.");
    } else {
      setPeople(result.data || []);
      setMessage("");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Title>Your community</Title>
      <Field
        label="Search members by name"
        value={search}
        onChangeText={setSearch}
        maxLength={80}
      />
      <Button title="Search members" onPress={() => void load()} />
      <Feedback message={message} />
      <Muted>
        Up to 100 matching active members; refine your search to find someone.
      </Muted>
      {people.map((person, index) => (
        <Card key={index}>
          <Title>{person.display_name}</Title>
          <Body>{person.bio || "Part of the Gregslist community."}</Body>
        </Card>
      ))}
    </>
  );
}

function Updates({
  open,
  partners,
}: {
  open: (id: string) => void;
  partners: () => void;
}) {
  const [items, setItems] = useState<
    {
      id: string;
      message: string;
      kind: string;
      post_id: string | null;
      read_at: string | null;
      created_at: string;
    }[]
  >([]);
  const [message, setMessage] = useState("");
  async function load() {
    const result = await db
      .from("notifications")
      .select("id,message,kind,post_id,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (result.error) {
      setItems([]);
      setMessage("Updates could not be loaded.");
    } else setItems(result.data || []);
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Title>Your updates</Title>
      <Feedback message={message} />
      {!items.length && <Body>You’re up to date.</Body>}
      {items.map((item) => (
        <Card key={item.id}>
          <Muted>
            {item.read_at ? "Read" : "New"} ·{" "}
            {new Date(item.created_at).toLocaleString()}
          </Muted>
          <Body>{item.message}</Body>
          {item.post_id && (
            <Button
              title="View post"
              secondary
              onPress={() => open(item.post_id!)}
            />
          )}
          {item.kind.startsWith("partner_") && (
            <Button title="Manage partner link" secondary onPress={partners} />
          )}
          {!item.read_at && (
            <Button
              title="Mark as read"
              secondary
              onPress={() => {
                void db
                  .rpc("read_notification", { target_id: item.id })
                  .then(async (result) => {
                    if (result.error)
                      setMessage("Could not mark this update as read.");
                    else await load();
                  });
              }}
            />
          )}
        </Card>
      ))}
    </>
  );
}

function Settings({
  user,
  signOut,
}: {
  user: User;
  signOut: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void db
      .from("profiles")
      .select("display_name,bio")
      .eq("id", user.id)
      .single()
      .then((result) => {
        if (result.data) {
          setName(result.data.display_name);
          setBio(result.data.bio);
        } else setMessage("Profile could not be loaded.");
      });
  }, [user.id]);
  return (
    <>
      <Card>
        <Title>Your profile</Title>
        <Field
          label="Display name"
          value={name}
          onChangeText={setName}
          maxLength={80}
        />
        <Field
          label="A little about you"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={300}
        />
        <Muted>
          Visible to authorised community members. Keep contact details private.
        </Muted>
        <Feedback message={message} />
        <Button
          title="Save profile"
          disabled={busy}
          onPress={() => {
            if (!name.trim()) {
              setMessage("Enter a display name.");
              return;
            }
            setBusy(true);
            void db
              .from("profiles")
              .update({ display_name: name.trim(), bio: bio.trim() })
              .eq("id", user.id)
              .then((result) => {
                setMessage(
                  result.error
                    ? "Profile could not be saved."
                    : "Profile saved.",
                );
                setBusy(false);
              });
          }}
        />
        <Field
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={128}
        />
        <Button
          title="Change password"
          disabled={busy || password.length < 12}
          secondary
          onPress={() => {
            setBusy(true);
            void db.auth.updateUser({ password }).then((result) => {
              setMessage(
                result.error
                  ? "Password could not be changed. Recover it through the secure website if needed."
                  : "Password saved.",
              );
              setPassword("");
              setBusy(false);
            });
          }}
        />
        <Button
          title="Privacy and data handling"
          secondary
          onPress={() => openWeb("/privacy")}
        />
        <Button title="Sign out" secondary onPress={() => void signOut()} />
      </Card>
      <Deletion user={user} onDeleted={signOut} />
    </>
  );
}

function Deletion({
  user,
  onDeleted,
}: {
  user: User;
  onDeleted: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function erase() {
    setBusy(true);
    setMessage("");
    try {
      const session = (await db.auth.getSession()).data.session;
      if (!session || session.user.id !== user.id) {
        setMessage("Sign in again before deleting your account.");
        return;
      }
      const response = await fetch(`${siteUrl}/api/mobile/account-deletion`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password, confirmation: "DELETE" }),
        redirect: "error",
      });
      if (response.status === 200 || response.status === 202) {
        setPassword("");
        Alert.alert(
          response.status === 200
            ? "Account deleted"
            : "Deletion pending retry",
          response.status === 200
            ? "Your account and personal content have been removed. Minimal history expires within twelve months."
            : "Access and visible content have been removed. Account/media removal is not yet complete and is queued for retry.",
        );
        await onDeleted();
      } else {
        const result = await response.json();
        setMessage(
          typeof result.error === "string"
            ? result.error
            : "Deletion could not be completed.",
        );
      }
    } catch {
      setMessage(
        "Deletion could not be confirmed. Check access before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Title>Delete your account</Title>
      <Body>
        Deletion starts immediately and cannot be undone. Login/profile/contact
        data, uploads and authored text are removed; active arrangements close.
        Minimal pseudonymised event, ride and admin records expire within twelve
        months. Other members’ unrelated records remain.
      </Body>
      <Button
        title="Read the complete deletion policy"
        secondary
        onPress={() => openWeb("/account-deletion")}
      />
      <Field
        label="Current password to delete account"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        maxLength={128}
      />
      <Field
        label="Type DELETE to confirm"
        value={confirmation}
        onChangeText={setConfirmation}
        autoCapitalize="characters"
        maxLength={6}
      />
      <Feedback message={message} />
      <Button
        title={busy ? "Deleting…" : "Delete my account permanently"}
        disabled={busy || !password || confirmation !== "DELETE"}
        onPress={() =>
          Alert.alert(
            "Delete permanently?",
            "This starts immediately. It cannot be undone. The final administrator must first appoint another administrator.",
            [
              { text: "Keep account", style: "cancel" },
              {
                text: "Delete account",
                style: "destructive",
                onPress: () => void erase(),
              },
            ],
          )
        }
      />
    </Card>
  );
}

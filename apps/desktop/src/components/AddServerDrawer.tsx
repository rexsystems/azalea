import { useEffect, useState } from "react";
import type { Host, HostGroup, SshKey } from "@azalea/shared";
import { ChevronDown, Folder, KeyRound, Lock, Plug, Save, Trash2 } from "lucide-react";
import type { HostFormValues } from "../lib/utils";
import { Button } from "./ui/Button";
import { Drawer } from "./ui/Drawer";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";

interface AddServerDrawerProps {
  open: boolean;
  host?: Host | null;
  keys: SshKey[];
  groups: HostGroup[];
  initialValues?: Partial<HostFormValues>;
  defaultGroupId?: string | null;
  onClose: () => void;
  onSubmit: (values: HostFormValues, connectAfter: boolean) => Promise<void>;
  onDelete?: () => void;
}

const defaultValues: HostFormValues = {
  name: "",
  hostname: "",
  port: 22,
  username: "root",
  auth_type: "password",
  key_id: null,
  group_id: null,
  password: "",
};

export function AddServerDrawer({
  open,
  host,
  keys,
  groups,
  initialValues,
  defaultGroupId,
  onClose,
  onSubmit,
  onDelete,
}: AddServerDrawerProps) {
  const [values, setValues] = useState<HostFormValues>(defaultValues);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (host) {
      setValues({
        name: host.name,
        hostname: host.hostname,
        port: host.port,
        username: host.username,
        auth_type: host.auth_type,
        key_id: host.key_id,
        group_id: host.group_id,
        password: "",
      });
    } else {
      setValues({
        ...defaultValues,
        ...initialValues,
        group_id: defaultGroupId ?? initialValues?.group_id ?? null,
      });
    }
    setError(null);
    setShowAdvanced(false);
  }, [host, open, initialValues, defaultGroupId]);

  useEffect(() => {
    if (!host && values.hostname && !values.name) {
      setValues((prev) => ({
        ...prev,
        name: values.hostname.split(".")[0] || values.hostname,
      }));
    }
  }, [values.hostname, values.name, host]);

  const handleSubmit = async (connectAfter: boolean) => {
    if (!values.hostname || !values.username) {
      setError("Address and username are required.");
      return;
    }
    if (values.auth_type === "password" && !host && !values.password) {
      setError("Password is required.");
      return;
    }
    if (values.auth_type === "key" && !values.key_id) {
      setError("Select an SSH key.");
      return;
    }

    const finalValues = {
      ...values,
      name: values.name || values.hostname.split(".")[0] || values.hostname,
    };

    try {
      setSaving(true);
      setError(null);
      await onSubmit(finalValues, connectAfter);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const isEdit = Boolean(host);

  return (
    <Drawer
      open={open}
      title={isEdit ? "Edit server" : "Add server"}
      subtitle={isEdit ? "Update connection details" : "Save for one-click access"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          {!isEdit && (
            <Button
              variant="primary"
              className="flex-1"
              disabled={saving}
              onClick={() => void handleSubmit(true)}
            >
              <Plug size={16} />
              Save & Connect
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={saving}
            onClick={() => void handleSubmit(false)}
          >
            <Save size={16} />
            {saving ? "Saving..." : isEdit ? "Save" : "Save only"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <Input
            label="Address"
            placeholder="192.168.1.10"
            value={values.hostname}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, hostname: e.target.value }))
            }
          />
          <Input
            label="Port"
            type="number"
            value={values.port}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                port: Number(e.target.value) || 22,
              }))
            }
          />
        </div>

        <Input
          label="Username"
          value={values.username}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, username: e.target.value }))
          }
        />

        {groups.length > 0 && (
          <Select
            label="Group"
            value={values.group_id ?? ""}
            onChange={(groupId) =>
              setValues((prev) => ({
                ...prev,
                group_id: groupId || null,
              }))
            }
            options={[
              { value: "", label: "No group" },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        )}

        <div>
          <span className="mb-2 block text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            Login method
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setValues((prev) => ({ ...prev, auth_type: "password" }))
              }
              className="transition-ui flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
              style={
                values.auth_type === "password"
                  ? {
                      borderColor: "var(--accent)",
                      background: "var(--accent-muted)",
                      color: "var(--text)",
                    }
                  : {
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-muted)",
                    }
              }
            >
              <Lock size={16} />
              Password
            </button>
            <button
              type="button"
              onClick={() =>
                setValues((prev) => ({ ...prev, auth_type: "key" }))
              }
              className="transition-ui flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
              style={
                values.auth_type === "key"
                  ? {
                      borderColor: "var(--accent)",
                      background: "var(--accent-muted)",
                      color: "var(--text)",
                    }
                  : {
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-muted)",
                    }
              }
            >
              <KeyRound size={16} />
              SSH Key
            </button>
          </div>
        </div>

        {values.auth_type === "password" ? (
          <Input
            label="Password"
            type="password"
            placeholder={isEdit ? "Leave blank to keep current" : "Password"}
            value={values.password}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, password: e.target.value }))
            }
          />
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            No SSH keys yet. Add one from the Keys menu.
          </div>
        ) : (
          <Select
            label="SSH Key"
            value={values.key_id ?? ""}
            placeholder="Choose a key..."
            onChange={(keyId) =>
              setValues((prev) => ({
                ...prev,
                key_id: keyId || null,
              }))
            }
            options={keys.map((key) => ({ value: key.id, label: key.name }))}
          />
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="transition-ui flex items-center gap-1 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronDown
            size={16}
            className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
          Display name
        </button>

        {showAdvanced && (
          <Input
            label="Display name"
            hint="Auto-filled from address if empty"
            value={values.name}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, name: e.target.value }))
            }
          />
        )}

        {groups.length === 0 && (
          <p className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <Folder size={12} />
            Tip: create a group from the home screen to organize servers
          </p>
        )}

        {error && (
          <p className="rounded-xl bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {isEdit && onDelete && (
          <div
            className="border-t pt-5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <Button
              variant="danger"
              className="w-full"
              disabled={saving}
              onClick={onDelete}
            >
              <Trash2 size={16} />
              Delete server
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

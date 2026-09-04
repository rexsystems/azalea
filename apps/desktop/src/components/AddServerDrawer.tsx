import { useEffect, useState } from "react";
import type { Host, HostGroup, SshKey } from "@azalea/shared";
import {
  ChevronDown,
  EthernetPort,
  Folder,
  KeyRound,
  Lock,
  Network,
  Save,
  Server,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import type { HostFormValues } from "../lib/utils";
import { parsePortInput, validateHostForm } from "../lib/utils";
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
  mac_address: "",
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
        mac_address: host.mac_address ?? "",
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

  const isEdit = Boolean(host);

  const handleSubmit = async (connectAfter: boolean) => {
    const validationError = validateHostForm(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    const keyId = values.key_id?.trim() || null;
    const hasPasswordInput = Boolean(values.password.trim());
    const authType: HostFormValues["auth_type"] = keyId
      ? "key"
      : hasPasswordInput
        ? "password"
        : "none";

    const finalValues: HostFormValues = {
      ...values,
      auth_type: authType,
      key_id: keyId,
      hostname: values.hostname.trim(),
      username: values.username.trim(),
      name: values.name.trim() || values.hostname.trim().split(".")[0] || values.hostname.trim(),
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
              className="flex-1 !gap-2.5"
              disabled={saving}
              onClick={() => void handleSubmit(true)}
            >
              <EthernetPort size={20} strokeWidth={2.25} />
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
        <Input
          label="Display name"
          hint="Shown in your host list"
          placeholder="My server"
          icon={<Tag size={15} />}
          value={values.name}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, name: e.target.value }))
          }
        />

        <div className="grid grid-cols-[1fr_80px] gap-3">
          <Input
            label="Address"
            placeholder="192.168.1.10 or server.example.com"
            icon={<Server size={15} />}
            value={values.hostname}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, hostname: e.target.value }))
            }
          />
          <Input
            label="Port"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="22"
            value={String(values.port)}
            onChange={(e) => {
              const next = parsePortInput(e.target.value);
              setValues((prev) => ({
                ...prev,
                port: next ?? prev.port,
              }));
            }}
          />
        </div>

        <Input
          label="Username"
          icon={<User size={15} />}
          value={values.username}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, username: e.target.value }))
          }
        />

        {groups.length > 0 && (
          <Select
            label="Group"
            icon={<Folder size={15} />}
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

        <Input
          label="Password"
          type="password"
          placeholder={isEdit ? "Leave blank to keep current" : "Optional"}
          hint={isEdit ? undefined : "Optional — you can also use an SSH key"}
          icon={<Lock size={15} />}
          value={values.password}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, password: e.target.value }))
          }
        />

        {keys.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
              background: "var(--bg-card)",
            }}
          >
            <span className="mb-1 flex items-center gap-2 font-medium" style={{ color: "var(--text-secondary)" }}>
              <KeyRound size={15} />
              SSH Key
            </span>
            No SSH keys yet. You can save this host and pick a key when connecting.
          </div>
        ) : (
          <Select
            label="SSH Key"
            icon={<KeyRound size={15} />}
            value={values.key_id ?? ""}
            placeholder="Optional — choose when connecting"
            onChange={(keyId) =>
              setValues((prev) => ({
                ...prev,
                key_id: keyId || null,
              }))
            }
            options={[
              { value: "", label: "None — choose when connecting" },
              ...keys.map((key) => ({ value: key.id, label: key.name })),
            ]}
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
          Advanced
        </button>

        {showAdvanced && (
          <Input
            label="MAC address"
            hint="For Wake-on-LAN when the server is offline"
            placeholder="AA:BB:CC:DD:EE:FF"
            icon={<Network size={15} />}
            value={values.mac_address}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, mac_address: e.target.value }))
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

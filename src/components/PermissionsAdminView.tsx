import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Check, Eye, RotateCcw, Shield, Users } from 'lucide-react';
import { ADMIN_EMAIL, db, handleFirestoreError, OperationType } from '../firebase';
import {
  DEFAULT_ROLE_PERMISSIONS,
  EDITION_METADATA,
  EDITION_ORDER,
  PERMISSION_CATALOG,
} from '../lib/permissions';
import { seedDefaultRolePermissions } from '../lib/seedData';
import type { PermissionKey, RolePermissionFlags, UserProfile, UserRole } from '../types';

interface PermissionsAdminViewProps {
  rolePermissions: Record<UserRole, RolePermissionFlags>;
  usersList: UserProfile[];
  activeEdition: UserRole;
  canEditPermissions: boolean;
  isPrincipalAccount: boolean;
  userName: string;
  onPreviewEdition: (role: UserRole) => void;
  onNotify: (msg: string) => void;
}

export const PermissionsAdminView: React.FC<PermissionsAdminViewProps> = ({
  rolePermissions,
  usersList,
  activeEdition,
  canEditPermissions,
  isPrincipalAccount,
  userName,
  onPreviewEdition,
  onNotify,
}) => {
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [updatingUserUid, setUpdatingUserUid] = useState<string | null>(null);

  const handleTogglePermission = async (role: UserRole, key: PermissionKey) => {
    if (!canEditPermissions) return;
    if (role === 'admin' && key === 'managePermissions') {
      onNotify('تبقى صلاحية إدارة الصلاحيات مفعّلة دائماً لنسخة المدراء لضمان عدم فقدان التحكم.');
      return;
    }
    if (role === 'parent' && key === 'deductBehavior') {
      onNotify('التنقيص من درجة السلوك مقتصر على المدرسين والمدراء والمراقبين فقط.');
      return;
    }

    const cellId = `${role}_${key}`;
    setSavingCell(cellId);
    const currentFlags = rolePermissions[role];
    const nextValue = !currentFlags[key];

    const updatedFlags: RolePermissionFlags = {
      ...currentFlags,
      [key]: nextValue,
    };

    try {
      await setDoc(
        doc(db, 'rolePermissions', role),
        {
          role,
          label: EDITION_METADATA[role].title,
          ...updatedFlags,
          scope: 'school',
          updatedBy: userName || 'إدارة المدرسة',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      const permMeta = PERMISSION_CATALOG.find((p) => p.key === key);
      onNotify(
        `تم ${nextValue ? 'تفعيل' : 'إيقاف'} صلاحية "${permMeta?.label || key}" في ${EDITION_METADATA[role].title}.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rolePermissions/${role}`);
    } finally {
      setSavingCell(null);
    }
  };

  const handleResetDefaults = async () => {
    if (!canEditPermissions) return;
    setResetting(true);
    try {
      await seedDefaultRolePermissions(userName || 'إدارة المدرسة');
      onNotify('تمت استعادة الصلاحيات الافتراضية المعتمدة للنسخ الأربع بنجاح.');
    } finally {
      setResetting(false);
    }
  };

  const handleAssignUserRole = async (profile: UserProfile, newRole: UserRole) => {
    if (!canEditPermissions) return;
    if (profile.email === ADMIN_EMAIL && newRole !== 'admin') {
      onNotify('لا يمكن تغيير الدور الأساسي لحساب مدير النظام الرئيسي.');
      return;
    }

    setUpdatingUserUid(profile.uid);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        `تم تعيين "${profile.displayName}" إلى ${EDITION_METADATA[newRole].title} بنجاح.`,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setUpdatingUserUid(null);
    }
  };

  const totalPermissionsCount = PERMISSION_CATALOG.length;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <h2 className="text-lg font-bold font-display text-slate-900">
            إدارة النسخ الأربع وصلاحيات الوصول
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            تخصيص صلاحيات كل نسخة (ولي الأمر والطالب، المدرسين، المدراء، المراقبين) وتعيين أدوار
            المستخدمين مباشرة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canEditPermissions && (
            <button
              type="button"
              disabled={resetting}
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{resetting ? 'جاري الاستعادة...' : 'استعادة الصلاحيات الافتراضية'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Editions Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {EDITION_ORDER.map((role, index) => {
          const meta = EDITION_METADATA[role];
          const perms = rolePermissions[role] || DEFAULT_ROLE_PERMISSIONS[role];
          const enabledCount = PERMISSION_CATALOG.filter((p) => perms[p.key]).length;
          const isCurrent = activeEdition === role;

          return (
            <div
              key={role}
              className={`bg-white border rounded-xl p-5 flex flex-col justify-between space-y-4 ${
                isCurrent ? 'border-teal-700' : 'border-slate-200'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono-num">النسخة 0{index + 1}</span>
                  <span>{meta.audience}</span>
                </div>
                <h3 className="text-base font-bold font-display text-slate-900">{meta.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{meta.summary}</p>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">الصلاحيات المفعّلة</span>
                  <span className="font-mono-num font-bold text-teal-700">
                    {enabledCount} / {totalPermissionsCount}
                  </span>
                </div>
                {isPrincipalAccount && (
                  <button
                    type="button"
                    onClick={() => onPreviewEdition(role)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      isCurrent
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isCurrent ? 'النسخة قيد العرض حالياً' : 'معاينة هذه النسخة'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Permissions Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-700" />
            <h3 className="text-base font-bold font-display text-slate-900">
              مصفوفة تعديل صلاحيات النسخ الأربع
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            يتم حفظ كل تعديل تلقائياً في قاعدة البيانات وتطبيقه فوراً
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3.5 px-5 font-semibold">الصلاحية والوصف</th>
                {EDITION_ORDER.map((role) => (
                  <th key={role} className="py-3.5 px-4 font-semibold text-center whitespace-nowrap">
                    {EDITION_METADATA[role].shortTitle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PERMISSION_CATALOG.map((perm) => (
                <tr key={perm.key} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-5">
                    <p className="text-xs text-teal-700 font-medium">{perm.group}</p>
                    <p className="font-semibold text-slate-900 mt-0.5">{perm.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{perm.description}</p>
                  </td>
                  {EDITION_ORDER.map((role) => {
                    const enabled = Boolean(rolePermissions[role]?.[perm.key]);
                    const isLockedAdmin = role === 'admin' && perm.key === 'managePermissions';
                    const isLockedParentBehavior = role === 'parent' && perm.key === 'deductBehavior';
                    const isLocked = isLockedAdmin || isLockedParentBehavior;
                    const cellId = `${role}_${perm.key}`;
                    const busy = savingCell === cellId;

                    return (
                      <td key={role} className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          disabled={!canEditPermissions || isLocked || busy}
                          onClick={() => handleTogglePermission(role, perm.key)}
                          className={`inline-flex items-center justify-center gap-1.5 min-w-[92px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                            isLocked
                              ? 'bg-slate-100 border-slate-200 text-slate-600 cursor-not-allowed'
                              : enabled
                                ? 'bg-teal-700 border-teal-700 text-white hover:bg-teal-800 cursor-pointer'
                                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100 cursor-pointer'
                          } disabled:opacity-70`}
                        >
                          {enabled && <Check className="w-3.5 h-3.5" />}
                          <span>
                            {isLockedAdmin
                              ? 'محمية'
                              : isLockedParentBehavior
                                ? 'غير متاحة'
                                : enabled
                                  ? 'مفعّلة'
                                  : 'موقوفة'}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registered User Accounts & Role Assignment */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-700" />
            <h3 className="text-base font-bold font-display text-slate-900">
              تعيين النسخة والدور لحسابات المستخدمين
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-mono-num">
            {usersList.length} حساب مسجل
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="py-3 px-5 font-semibold">اسم المستخدم</th>
                <th className="py-3 px-4 font-semibold">البريد الإلكتروني</th>
                <th className="py-3 px-4 font-semibold">النسخة المخصصة حالياً</th>
                <th className="py-3 px-4 font-semibold">تغيير الصلاحية / النسخة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersList.map((u) => {
                const isPrincipalRow = u.email === ADMIN_EMAIL;
                const roleMeta = EDITION_METADATA[u.role] || EDITION_METADATA.parent;

                return (
                  <tr key={u.uid} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-5 font-semibold text-slate-900">
                      {u.displayName}
                    </td>
                    <td className="py-3.5 px-4 font-mono-num text-xs text-slate-600">
                      {u.email}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-teal-800">
                      {roleMeta.title}
                    </td>
                    <td className="py-3.5 px-4">
                      <select
                        value={u.role}
                        disabled={!canEditPermissions || isPrincipalRow || updatingUserUid === u.uid}
                        onChange={(e) => handleAssignUserRole(u, e.target.value as UserRole)}
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        {EDITION_ORDER.map((roleOpt) => (
                          <option key={roleOpt} value={roleOpt}>
                            {EDITION_METADATA[roleOpt].title}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {usersList.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    لا توجد حسابات مسجلة لعرضها حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

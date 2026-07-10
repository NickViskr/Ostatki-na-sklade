import React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, X } from 'lucide-react';

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  show,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена'
}) => {
  if (!show || typeof document === 'undefined') return null;

  return createPortal(
    <div 
      key="confirm-dialog-overlay" 
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 fade-in"
    >
      <div
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden modal-enter"
      >
        <div className="p-6 flex items-start gap-4">
          <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center shrink-0">
            <AlertCircle className="text-amber-600" size={24} />
          </div>
          <div className="flex-1 pt-1">
            <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{message}</p>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl font-bold text-slate-600 hover:bg-white transition-all border border-slate-200"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onCancel();
            }}
            className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

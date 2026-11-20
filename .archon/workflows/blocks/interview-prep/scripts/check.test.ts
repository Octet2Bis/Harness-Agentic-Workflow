import { describe, expect, test } from 'bun:test';
import { offerFromBoard, parseKeywords, pickApplicationFiles, readOffer, textOrFile } from './check.ts';

describe('interview-prep : lecture des pièces', () => {
  test('lit l’offre, décode les entités, prend description_full pour l’annonce', () => {
    const offer = readOffer('{"company":"Acme &amp; Co","title":"Growth Ops","description":"court","description_full":"Annonce complète","skills_required":"n8n, GTM"}');
    expect(offer).toEqual({ company: 'Acme & Co', title: 'Growth Ops', keywords: '', skills_required: 'n8n, GTM', posting: 'Annonce complète' });
    expect(readOffer('{"company":"Acme","job_title":"Growth Ops"}').title).toBe('Growth Ops');
    expect(readOffer('pas du json').company).toBe('');
    expect(readOffer('[1]').company).toBe('');
  });
  test('les mots-clés de l’offre priment sur skills_required', () => {
    expect(parseKeywords(readOffer('{"keywords":"SQL; Python\\nSQL","skills_required":"x"}'))).toEqual(['SQL', 'Python']);
    expect(parseKeywords(readOffer('{"skills_required":"n8n, GTM"}'))).toEqual(['n8n', 'GTM']);
    expect(parseKeywords(readOffer('{}'))).toEqual([]);
  });
  test('trouve les pièces d’un dossier applications/<slug>/ sous les noms du bot', () => {
    const names = ['CV_Antoine_Lecerf_acme.pdf', 'CV_Antoine_Lecerf_acme.md', 'Message_Accroche_acme.md', 'interlocuteur_cible.json', 'remarques_utilisateur.txt', 'offer.json', 'annonce.txt', 'submission_receipt.json'];
    expect(pickApplicationFiles(names)).toEqual({
      offer: 'offer.json',
      posting: 'annonce.txt',
      cv: 'CV_Antoine_Lecerf_acme.md',
      pitch: 'Message_Accroche_acme.md',
      contact: 'interlocuteur_cible.json',
      remarks: 'remarques_utilisateur.txt',
    });
    expect(pickApplicationFiles(['CV.md', 'pitch.md', 'candidate.json'])).toMatchObject({ cv: 'CV.md', pitch: 'pitch.md', offer: undefined, posting: undefined });
    expect(pickApplicationFiles([])).toEqual({ offer: undefined, posting: undefined, cv: undefined, pitch: undefined, contact: undefined, remarks: undefined });
  });
  test('les notes de recherche : un chemin lisible, sinon le texte lui-même', () => {
    const read = (path: string) => (path === '/notes.md' ? 'contenu des notes' : null);
    expect(textOrFile('/notes.md', read)).toBe('contenu des notes');
    expect(textOrFile('Levée de fonds annoncée en mars', read)).toBe('Levée de fonds annoncée en mars');
    expect(textOrFile('ligne 1\n/notes.md', read)).toBe('ligne 1\n/notes.md');
    expect(textOrFile('  ', read)).toBe('');
  });
  test('sans offre dans le dossier, l’offre du tableau par son slug (BOM toléré)', () => {
    const board = '\uFEFF[{"slug":"globex","company":"Globex"},{"slug":"acme","company":"Acme","title":"Growth Ops","description":"Résumé du radar","skills_required":"n8n"}]';
    expect(readOffer(offerFromBoard(board, 'ACME'))).toMatchObject({ company: 'Acme', title: 'Growth Ops', posting: 'Résumé du radar', skills_required: 'n8n' });
    expect(offerFromBoard(board, 'initech')).toBe('');
    expect(offerFromBoard('{"slug":"acme"}', 'acme')).toBe('');
    expect(offerFromBoard('illisible', 'acme')).toBe('');
  });
});

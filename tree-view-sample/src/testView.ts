import * as vscode from 'vscode';

export class TestView {

	constructor(context: vscode.ExtensionContext) {
		/**
		 * [Q]
		 * provider = new FtpTreeDataProvider(ftpModel);
		 * vscode.window.createTreeView('xxx', { provider });
		 * 还可以写成：
		 * vscode.window.createTreeView('xxx', { treeDataProvider: FtpTreeDataProvider(ftpModel), showCollapse: true});
		 * 前者入参是集合，后者入参是字典 —— 这都是啥语法啊！WTF！
		 * [A]
		 * createTreeView() 的原型是：
		   *   export function createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;
		 * TreeViewOptions 共 3 个元素
		 * 		treeDataProvider: TreeDataProvider<T>;
		 * 		showCollapseAll?: boolean; —— 是否默认全部展开
		 * 		canSelectMany?: boolean; —— 是否支持 treeitem 多选
		 * 
		 */
		const view = vscode.window.createTreeView('testView', { treeDataProvider: aNodeWithIdTreeDataProvider(), showCollapseAll: true });
		context.subscriptions.push(view);
		vscode.commands.registerCommand('testView.reveal', async () => {
			const key = await vscode.window.showInputBox({ placeHolder: 'Type the label of the item to reveal' });
			if (key) {
				await view.reveal({ key }, { focus: true, select: false, expand: true });
			}
		});
		vscode.commands.registerCommand('testView.changeTitle', async () => {
			const title = await vscode.window.showInputBox({ prompt: 'Type the new title for the Test View', placeHolder: view.title });
			if (title) {
				view.title = title;
			}
		});
	}
}

// aa 必须排在 a 后面，aaa 必须排在 aa 后面……具体参考 getTreeElement()
const tree = {
	'a': {
		'aa': {
			'aaa': {
				'aaaa': {
					'aaaaa': {
						'aaaaaa': {

						}
					}
				}
			}
		},
		'ab': {}
	},
	'b': {
		'ba': {},
		'bb': {}
	}
};
const nodes = {};

function aNodeWithIdTreeDataProvider(): vscode.TreeDataProvider<{ key: string }> {
	return {
		getChildren: (element: { key: string }): { key: string }[] => {
			return getChildren(element ? element.key : undefined).map(key => getNode(key));
		},
		getTreeItem: (element: { key: string }): vscode.TreeItem => {
			const treeItem = getTreeItem(element.key);
			treeItem.id = element.key;
			return treeItem;
		},
		getParent: ({ key }: { key: string }): { key: string } => {
			const parentKey = key.substring(0, key.length - 1);
			return parentKey ? new Key(parentKey) : void 0;
		}
	};
}

function getChildren(key: string): string[] {
	if (!key) {
		return Object.keys(tree);
	}
	const treeElement = getTreeElement(key);
	if (treeElement) {
		return Object.keys(treeElement);
	}
	return [];
}

function getTreeItem(key: string): vscode.TreeItem {
	const treeElement = getTreeElement(key);
	// An example of how to use codicons in a MarkdownString in a tree item tooltip.
	const tooltip = new vscode.MarkdownString(`$(zap) Tooltip for ${key}`, true);
	return {
		label: /**vscode.TreeItemLabel**/<any>{ label: key, highlights: key.length > 1 ? [[key.length - 2, key.length - 1]] : void 0 },
		tooltip,
		collapsibleState: treeElement && Object.keys(treeElement).length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	};
}

function getTreeElement(element): any {
	// 用 tree 中的字母以此查找，所以 tree 中的 aaa 必须排在 aa 后面，否则就找不出来了
	let parent = tree;
	for (let i = 0; i < element.length; i++) {
		parent = parent[element.substring(0, i + 1)];
		if (!parent) {
			return null;
		}
	}
	return parent; // 此时的 parent 已经是 child 了
}

function getNode(key: string): { key: string } {
	if (!nodes[key]) {
		nodes[key] = new Key(key);
	}
	return nodes[key];
}

class Key {
	constructor(readonly key: string) { }
}